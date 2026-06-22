# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-019.md

# Part 019 — Tasklist and Human Work Management at Scale

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Bagian: `019`  
> Topik: Tasklist, human task management, work queues, assignment, authorization, custom task apps, SLA, auditability, dan scale design  
> Target: advanced Java/backend/process engineer yang perlu mendesain workflow manusia + sistem yang production-grade, defensible, observable, dan scalable.

---

## 0. Kenapa Bagian Ini Penting?

Dalam Camunda 8, automated orchestration sering terlihat lebih “engineering-heavy”: Zeebe broker, gateway, worker, partitions, exporters, backpressure, idempotency, retry, dan message correlation.

Namun dalam sistem enterprise yang nyata, terutama regulatory, case management, approval, review, compliance, enforcement, licensing, finance, insurance, public service, dan operations, bottleneck terbesar sering bukan service task otomatis, melainkan **human work**:

- siapa harus mengerjakan task?
- siapa boleh melihat task?
- siapa boleh claim?
- siapa boleh reassign?
- bagaimana memastikan SLA tidak lewat?
- bagaimana bukti keputusan manusia disimpan?
- bagaimana task tidak hilang saat projection lag?
- bagaimana supervisor melihat backlog?
- bagaimana workload dibagi secara adil?
- bagaimana custom UI harus dibangun jika Tasklist bawaan tidak cukup?
- bagaimana task lifecycle tetap konsisten walau user double-click, browser stale, atau dua officer claim bersamaan?
- bagaimana workflow tetap defensible ketika keputusan manusia dipertanyakan?

Bagian ini bukan sekadar “cara pakai Tasklist”.  
Bagian ini membangun mental model bahwa **human task adalah kontrak kerja manusia yang dieksekusi di atas process engine, ditampilkan melalui read-side projection, dan harus dikelola seperti distributed work queue dengan authorization, audit, SLA, dan lifecycle governance**.

---

## 1. Posisi Tasklist dalam Camunda 8

Camunda 8 memiliki beberapa komponen penting:

```text
+-------------------+
|  User / Officer   |
+---------+---------+
          |
          v
+-------------------+
|     Tasklist      |
|  Human task UI    |
+---------+---------+
          |
          | reads projected task data
          v
+-----------------------------+
| Elasticsearch / OpenSearch  |
| secondary/read storage      |
+-------------+---------------+
              ^
              |
              | exported records
              |
+-------------+---------------+
|        Zeebe Broker          |
| source of orchestration      |
| truth / command processing   |
+-------------+---------------+
              ^
              |
              | commands
              |
+-------------+---------------+
| Camunda Client / REST/gRPC   |
| worker / custom app / API    |
+-----------------------------+
```

Tasklist bukan process engine.  
Tasklist bukan source of truth.  
Tasklist adalah **human work surface** yang membantu user melihat, claim, assign, inspect, dan complete user task berdasarkan data yang diproyeksikan dari Zeebe.

Implikasi penting:

1. Tasklist bisa tertinggal dari engine karena projection lag.
2. Task visibility bergantung pada read model dan authorization setup.
3. Complete task tetap harus dipahami sebagai command terhadap orchestration lifecycle.
4. Untuk desain custom UI, kita harus paham perbedaan antara:
   - task query,
   - task claim,
   - task assign,
   - task complete,
   - process state,
   - read-side freshness,
   - authorization.

---

## 2. Mental Model: User Task sebagai Work Contract

User task bukan sekadar “form screen”.  
User task adalah **kontrak eksplisit bahwa proses menunggu kontribusi manusia**.

Kontrak itu minimal terdiri dari:

```text
UserTaskContract
├── identity
│   ├── task key/id
│   ├── process instance key
│   ├── process definition id
│   ├── BPMN element id
│   └── tenant / environment context
│
├── work intent
│   ├── title
│   ├── description
│   ├── decision needed
│   ├── expected output
│   └── allowed action
│
├── assignment
│   ├── assignee
│   ├── candidate users
│   ├── candidate groups
│   ├── role / permission rule
│   └── escalation owner
│
├── timing
│   ├── created time
│   ├── follow-up date
│   ├── due date
│   ├── SLA clock
│   └── escalation threshold
│
├── data
│   ├── input variables
│   ├── form schema
│   ├── output variables
│   ├── evidence/document references
│   └── validation rules
│
├── lifecycle
│   ├── created
│   ├── available
│   ├── claimed
│   ├── assigned
│   ├── completed
│   ├── cancelled
│   ├── returned/unassigned
│   └── escalated
│
└── audit
    ├── who viewed
    ├── who claimed
    ├── who changed assignment
    ├── who completed
    ├── what decision was made
    ├── what data changed
    └── why decision was made
```

A top-level engineer does not treat a user task as a UI widget.  
They treat it as a **human-state transition boundary** in a long-running business process.

---

## 3. User Task vs Service Task

A service task externalizes execution to a machine worker.  
A user task externalizes execution to a human actor.

```text
Service task
├── executor: Java worker / connector
├── input: process variables
├── output: process variables
├── lifecycle risk: retries, idempotency, timeout
└── failure mode: job failure / BPMN error / incident

User task
├── executor: human user / officer / approver
├── input: process variables + form + context
├── output: decision + form values + notes + evidence
├── lifecycle risk: assignment, stale UI, authorization, SLA, audit
└── failure mode: overdue, wrong user, invalid decision, duplicate submit, missing evidence
```

Perbedaan paling penting:

```text
Machine task correctness:
"Can the system safely retry?"

Human task correctness:
"Can the organization prove the right person made the right decision,
with the right information, within the right deadline?"
```

---

## 4. Tasklist sebagai Inbox vs Work Management Platform

Tasklist bawaan Camunda cocok untuk banyak use case:

- user melihat available tasks,
- user claim task,
- user complete form,
- user melihat detail process/task,
- team mengerjakan queue sederhana,
- workflow human approval basic,
- prototype/proof-of-concept,
- internal operation sederhana.

Namun pada skala enterprise, Tasklist sering hanya menjadi salah satu opsi.

Kita perlu membedakan:

```text
Tasklist as UI
    cocok ketika workflow human task relatif standar.

Tasklist API as backend capability
    cocok ketika organisasi perlu custom task app.

Custom case/task management system
    cocok ketika work distribution, security, evidence, SLA, dashboard,
    hierarchy, delegation, and audit requirement sangat kompleks.
```

Dalam regulatory system, licensing, enforcement, complaint, dispute, appeal, dan investigation, sering kali user tidak hanya butuh “task list”, tetapi:

- case overview,
- party profile,
- entity relationship,
- timeline,
- document bundle,
- prior decision,
- risk score,
- statutory deadline,
- assignment history,
- supervisor escalation,
- conflict of interest check,
- maker-checker separation,
- comment thread,
- evidence review,
- correspondence,
- audit trail,
- controlled override.

Maka keputusan arsitekturalnya bukan “pakai Tasklist atau tidak”, tetapi:

> Apakah Tasklist cukup sebagai primary workbench, atau kita perlu custom task/case application yang menggunakan Camunda sebagai orchestration backbone?

---

## 5. User Task Lifecycle

Secara konseptual, lifecycle user task dapat dilihat seperti ini:

```text
PROCESS ARRIVES AT USER TASK
          |
          v
+------------------+
| task created     |
+------------------+
          |
          v
+------------------+
| visible/available|
+------------------+
          |
          +--------------------+
          |                    |
          v                    v
+------------------+     +------------------+
| claimed by user  |     | assigned by rule |
+------------------+     +------------------+
          |                    |
          +---------+----------+
                    |
                    v
          +------------------+
          | user works task  |
          +------------------+
                    |
       +------------+-------------+
       |                          |
       v                          v
+------------------+       +------------------+
| complete task    |       | return/unassign  |
+------------------+       +------------------+
       |
       v
+------------------+
| process continues|
+------------------+
```

Namun lifecycle production tidak sesederhana itu. Ada kondisi tambahan:

```text
created
available
claimed
assigned
delegated
returned
reassigned
completed
cancelled by process
expired / overdue
escalated
blocked
withdrawn
superseded by new process version
hidden due to authorization change
stale in projection
```

Camunda 8 user task lifecycle documentation menyebut event seperti creating dan assigning, dengan action assignment seperti claim, assign, return, dan unassign. Dalam desain custom task application, event/lifecycle seperti ini harus dianggap sebagai domain signal, bukan sekadar UI interaction.

---

## 6. Assignment Model: Assignee, Candidate Users, Candidate Groups

User task assignment biasanya mencakup:

```text
assignee
    user yang bertanggung jawab mengerjakan task.

candidate users
    daftar user yang boleh mengambil/mengerjakan task.

candidate groups
    daftar group/role/team yang menjadi kandidat pengerja task.

due date
    deadline penyelesaian task.

follow-up date
    waktu task mulai perlu diperhatikan/dikerjakan.

priority
    sinyal ordering/urgency.

custom headers / extension properties
    metadata tambahan untuk routing/workload logic.
```

Contoh BPMN-level thinking:

```text
Review Application
├── candidate group: application-reviewer
├── due date: application.receivedAt + 5 business days
├── form: application-review-form
├── input variables:
│   ├── applicationId
│   ├── applicantName
│   ├── riskScore
│   ├── submittedDocuments
│   └── reviewContext
└── output variables:
    ├── reviewDecision
    ├── reviewRemarks
    ├── missingDocumentCodes
    └── reviewerId
```

Namun ada nuance penting: pada beberapa versi/mode Tasklist, candidate users/groups adalah metadata dan authorization bisa dikontrol melalui authorization model terpisah. Maka jangan desain security production dengan asumsi bahwa string `candidateGroups = "manager"` otomatis cukup untuk membatasi akses, kecuali model authorization runtime sudah diverifikasi.

### Engineering rule

```text
Candidate group is routing metadata until proven to be enforced authorization.
```

Untuk sistem regulated, lakukan dua lapis:

1. BPMN/task metadata untuk routing dan readability.
2. Authorization policy untuk akses aktual.

---

## 7. Claim, Assign, Return, Unassign: Semantics yang Harus Jelas

Dalam UI sederhana, user hanya klik “claim” lalu “complete”.  
Dalam enterprise workflow, semantics harus eksplisit.

### 7.1 Claim

Claim berarti user mengambil tanggung jawab dari shared queue.

```text
Before:
    assignee = null
    candidateGroup = review-team

After:
    assignee = fajar
```

Makna organisasi:

- user menyatakan “saya sedang mengerjakan ini”,
- task keluar dari available pool,
- supervisor bisa melihat ownership,
- SLA individual bisa mulai dihitung,
- konflik claim bersamaan harus ditangani.

Failure/race case:

```text
User A melihat task available.
User B juga melihat task available.
User A claim berhasil.
User B claim setelah itu gagal / ditolak / stale.
```

Custom UI harus menangani ini dengan jelas:

```text
"This task has already been claimed by another user. Refresh your queue."
```

Jangan silently ignore.

### 7.2 Assign

Assign berarti task diberikan kepada user tertentu, biasanya oleh supervisor, automation rule, or workload allocator.

```text
assignee = john
```

Assignment bisa terjadi:

- saat task dibuat,
- oleh supervisor,
- oleh auto-routing worker,
- oleh custom task management service,
- berdasarkan skill, workload, region, risk level, or case type.

Engineering concern:

- assignment harus auditable,
- assignment harus authorization-aware,
- assignment harus reversible,
- assignment harus tidak menabrak separation of duties.

### 7.3 Return

Return berarti user mengembalikan task ke pool.

Possible reasons:

- salah assignment,
- user unavailable,
- conflict of interest,
- insufficient role,
- task perlu supervisor,
- duplicate task,
- case reassignment.

Return harus punya reason.

```json
{
  "action": "RETURN",
  "reasonCode": "CONFLICT_OF_INTEREST",
  "remarks": "Reviewer has prior involvement with applicant."
}
```

### 7.4 Unassign

Unassign menghapus assignee.

Ini bisa dipakai untuk:

- supervisor mengambil kembali task,
- user cuti/resign,
- workload rebalancing,
- stuck task repair.

Dalam regulated workflow, unassign by supervisor harus meninggalkan audit event.

---

## 8. Task Visibility vs Task Authorization

Ini salah satu bagian yang sering keliru.

Task visibility menjawab:

```text
Task apa yang muncul di list user?
```

Task authorization menjawab:

```text
Apakah user benar-benar boleh melihat/claim/complete task?
```

Task visibility dapat dipengaruhi oleh:

- assignee,
- candidate group,
- task filters,
- authorization,
- tenant,
- process definition access,
- custom query,
- projection lag.

Task authorization dapat dipengaruhi oleh:

- identity provider,
- Camunda Identity/Admin,
- process definition permission,
- tenant permission,
- task API token,
- custom app backend policy,
- enterprise RBAC/ABAC.

Dalam production, jangan mengandalkan frontend filtering.

```text
Bad:
    FE hides unauthorized tasks.

Better:
    backend query only authorized tasks.

Best:
    backend query authorized tasks + command authorization checked again
    on claim/assign/complete.
```

---

## 9. Tasklist V1/V2 dan Authorization Shift

Camunda 8 mengalami evolusi pada Tasklist dan API. Salah satu nuance penting dari dokumentasi modern adalah bahwa candidate users/groups tidak selalu dievaluasi oleh Tasklist untuk visibility/assignment dengan cara yang sama pada mode/versi berbeda. Pada Tasklist V2, dokumentasi menyebut authorization-based access control di process-definition level sebagai dasar access model, bukan semata candidate users/groups.

Implikasinya:

1. Selalu verifikasi versi Camunda 8 yang dipakai.
2. Jangan copy desain dari blog/forum lama tanpa cek docs versi target.
3. Treat assignment metadata dan authorization policy sebagai dua concern berbeda.
4. Untuk enterprise custom app, buat `TaskAuthorizationService` sendiri di backend jika butuh rule yang lebih granular.

Contoh rule yang sering tidak cukup jika hanya mengandalkan candidate group:

```text
User boleh melihat task jika:
- user punya permission untuk process definition,
- user berada di tenant yang sama,
- user berada di organization unit yang sama dengan case,
- user tidak memiliki conflict-of-interest,
- user punya certification level minimal,
- user tidak membuat submission yang sedang direview,
- user belum pernah menjadi maker untuk step sebelumnya,
- task belum locked oleh user lain.
```

Itu sudah ABAC/case-aware authorization, bukan sekadar candidate group.

---

## 10. Task Queue Design

Tasklist secara UI menyediakan queue. Namun engineer perlu mendesain queue semantics.

Pertanyaan desain:

1. Apakah queue per role?
2. Apakah queue per team?
3. Apakah queue per region?
4. Apakah queue per priority?
5. Apakah queue per SLA?
6. Apakah queue per case type?
7. Apakah queue shared atau personal?
8. Apakah task boleh diambil bebas atau harus assigned?
9. Apakah supervisor boleh override?
10. Apakah task harus disort by due date?
11. Apakah user boleh skip high-priority task?
12. Apakah assignment otomatis atau manual?

### 10.1 Queue sederhana

```text
review-team queue
├── Task A due today
├── Task B due tomorrow
└── Task C due next week
```

User claim sendiri.

Cocok untuk:

- low-risk tasks,
- team kecil,
- no strict skill routing,
- no conflict-of-interest.

### 10.2 Skill-based queue

```text
application-review
├── simple review: junior reviewer
├── complex review: senior reviewer
├── legal review: legal officer
└── financial review: finance officer
```

Butuh metadata:

```json
{
  "caseType": "LICENSE_APPLICATION",
  "riskLevel": "HIGH",
  "requiredSkill": "SENIOR_REVIEWER",
  "region": "CENTRAL"
}
```

### 10.3 Workload-balanced queue

Assignment berdasarkan:

- current assigned count,
- due date pressure,
- user availability,
- role,
- skill,
- conflict-of-interest,
- historical throughput.

```text
TaskRoutingService
├── reads available tasks
├── reads user capacity
├── checks authorization
├── checks conflict rules
├── assigns task
└── emits assignment audit event
```

### 10.4 Supervisor-controlled queue

Supervisor assigns tasks manually.

Cocok untuk:

- sensitive cases,
- legal/enforcement process,
- seniority-based review,
- discretionary task allocation.

---

## 11. Priority, Due Date, Follow-Up Date

Task priority and deadlines are not decorative. They define work ordering.

### 11.1 Follow-up date

Follow-up date answers:

```text
When should this task start receiving attention?
```

Example:

```text
Document clarification task:
- created today
- applicant has 7 days to respond
- follow-up date: day 5
- due date: day 7
```

### 11.2 Due date

Due date answers:

```text
When must this task be completed?
```

Due date can represent:

- internal SLA,
- contractual deadline,
- statutory deadline,
- service standard,
- escalation threshold.

### 11.3 Priority

Priority answers:

```text
When multiple tasks are available, which should be handled first?
```

Priority without queue governance is weak. If users can ignore high-priority tasks, priority is just UI decoration.

### 11.4 Engineering rule

```text
Due date is not enough.
You need:
- who owns the task,
- who monitors it,
- what happens when it is close to due,
- what happens when it is overdue,
- what evidence is captured,
- whether SLA clock can pause,
- whether deadline extension is allowed.
```

---

## 12. SLA Modelling for Human Tasks

Human SLA is different from technical timeout.

Technical timeout:

```text
worker job timeout = lease duration
```

Human SLA:

```text
review must be completed within 5 business days
```

Human SLA may depend on:

- business calendar,
- public holidays,
- working hours,
- submission completeness,
- applicant response period,
- pause/resume rules,
- case complexity,
- regulatory category,
- extension approval.

### 12.1 Simple SLA model

```text
User task due date = taskCreatedAt + PT48H
```

Cocok hanya untuk simple internal tasks.

### 12.2 Business calendar SLA model

```text
User task due date = addBusinessDays(taskCreatedAt, 5, "SG")
```

Butuh external calendar service or domain deadline calculator.

### 12.3 SLA pause model

Misalnya task menunggu applicant clarification.

```text
Review Task
    |
    v
Need Clarification?
    |
    +-- yes --> Applicant Response Task / Message Wait
    |              SLA paused
    |
    +-- no --> Continue Review
```

Jangan sekadar menaruh timer sembarangan. Definisikan:

```text
SLA clock state:
- RUNNING
- PAUSED_WAITING_APPLICANT
- PAUSED_INTERNAL_REVIEW
- EXTENDED
- BREACHED
- COMPLETED
```

### 12.4 SLA event projection

Untuk reporting:

```json
{
  "caseId": "APP-2026-001",
  "taskId": "review-1",
  "slaClock": "RUNNING",
  "startedAt": "2026-06-21T09:00:00+08:00",
  "dueAt": "2026-06-28T17:00:00+08:00",
  "pausedDurationMinutes": 0,
  "breached": false
}
```

---

## 13. Escalation Design

Escalation adalah process/business concern, bukan hanya notification.

Escalation patterns:

```text
1. Reminder
    send notification before due date.

2. Supervisor alert
    notify supervisor when due soon.

3. Reassignment
    move task to another user/team.

4. Parallel escalation
    keep original task but create supervisor review.

5. Interrupting escalation
    cancel original task and route to escalation path.

6. Case-level escalation
    raise case priority or change status.

7. Statutory breach handling
    record breach, notify management, prepare explanation.
```

### 13.1 Non-interrupting boundary timer

```text
[User Task: Review Application]
    |
    | non-interrupting timer after 3 days
    v
[Send Reminder]
```

Task remains active.

### 13.2 Interrupting boundary timer

```text
[User Task: Review Application]
    |
    | interrupting timer after 5 days
    v
[Escalate to Supervisor]
```

Task is cancelled and process moves to escalation.

### 13.3 Regulatory escalation

Untuk regulated workflow, escalation should capture:

- original assignee,
- due date,
- breached duration,
- reason if known,
- supervisor notified,
- corrective action,
- final resolution.

---

## 14. Human Task Data: Input, Form, Output

User task data harus dipisah menjadi:

```text
Input data
    data yang dibutuhkan user untuk mengambil keputusan.

Form data
    data yang ditampilkan/diedit user.

Output data
    decision/remarks/evidence hasil kerja user.

Audit data
    metadata siapa, kapan, dari mana, dan mengapa.

Reference data
    ID dokumen, external profile, case ID, risk score reference.
```

### 14.1 Jangan overload process variables

Bad:

```json
{
  "fullApplicationPdfBase64": "...",
  "allUploadedDocuments": [huge documents],
  "entireApplicantProfile": {...large object...}
}
```

Better:

```json
{
  "applicationId": "APP-2026-001",
  "documentBundleId": "DOCB-991",
  "applicantProfileRef": "PROFILE-882",
  "riskSummary": {
    "level": "HIGH",
    "reasonCodes": ["PRIOR_BREACH", "INCOMPLETE_DECLARATION"]
  }
}
```

Task UI can fetch rich context from domain services using references.

### 14.2 Form output contract

Example:

```json
{
  "reviewDecision": "REQUEST_CLARIFICATION",
  "reviewReasonCodes": [
    "MISSING_SUPPORTING_DOCUMENT"
  ],
  "reviewRemarks": "Please submit latest business registration.",
  "requiredDocumentCodes": [
    "BIZ_REG_LATEST"
  ],
  "reviewedBy": "user-123",
  "reviewedAt": "2026-06-21T10:15:00+08:00"
}
```

Avoid unstructured “remarks-only” decisions.

Bad:

```json
{
  "remarks": "ok"
}
```

Better:

```json
{
  "decision": "APPROVE",
  "reasonCodes": ["ALL_REQUIREMENTS_MET"],
  "remarks": "Application satisfies eligibility criteria."
}
```

---

## 15. Forms: Built-In, Generated, or Custom?

Camunda forms are useful for standard task completion.  
But forms alone rarely solve enterprise task UX.

### 15.1 Built-in form is enough when

- data is simple,
- decision is simple,
- no complex evidence viewer,
- no multi-tab case view,
- no special validation,
- no custom authorization,
- no offline/partial save,
- no complex collaboration.

### 15.2 Custom form/task UI is better when

- user needs case timeline,
- user needs document viewer,
- user needs side-by-side comparison,
- user needs external data lookup,
- user needs maker-checker controls,
- user needs dynamic field authorization,
- user needs draft save,
- user needs comments/thread,
- user needs bulk actions,
- user needs operational dashboard.

### 15.3 Hybrid approach

```text
Camunda:
    owns process state and task lifecycle.

Custom task app:
    owns rich UX, domain validation, evidence display, role-aware views.

Domain services:
    own business data and documents.

Tasklist/Operate:
    used for operational support and fallback visibility.
```

---

## 16. Custom Task Application Architecture

A custom task app should not talk directly from frontend to every Camunda endpoint without governance.

Better architecture:

```text
+----------------------+
| Browser / SPA        |
+----------+-----------+
           |
           v
+----------------------+
| Task App Backend     |
| - auth/session       |
| - task query         |
| - authorization      |
| - claim/complete     |
| - validation         |
| - audit              |
+----------+-----------+
           |
           +----------------------+
           | Camunda Task API /   |
           | Orchestration API    |
           +----------------------+
           |
           +----------------------+
           | Domain Services      |
           | case, profile, docs  |
           +----------------------+
           |
           +----------------------+
           | Audit Service        |
           +----------------------+
```

### 16.1 Why backend-for-frontend?

Because task access is contextual.

Frontend cannot safely enforce:

- tenant isolation,
- conflict-of-interest,
- role hierarchy,
- case-level permission,
- separation of duties,
- delegated authority,
- time-bound access,
- task completion validation,
- audit metadata.

### 16.2 Task app backend responsibilities

```text
TaskAppBackend
├── authenticate user
├── resolve roles/groups/tenant
├── query available tasks
├── enrich tasks with domain metadata
├── enforce task authorization
├── claim/assign/complete tasks
├── validate form decisions
├── write audit events
├── coordinate evidence submission
├── handle stale task errors
├── expose dashboard counts
└── protect Camunda API from direct UI abuse
```

---

## 17. Task Search at Scale

Task search looks simple until volume grows.

Search dimensions:

- assignee,
- candidate group,
- task state,
- process definition,
- process instance,
- creation time,
- due date,
- follow-up date,
- priority,
- tenant,
- business key/case id,
- custom variable,
- decision type,
- risk level,
- region/team.

### 17.1 Avoid variable-heavy task search

Querying by arbitrary variable is tempting.

Bad pattern:

```text
Search task where:
- applicantName contains X
- riskScore > 70
- productType = Y
- region = Z
- officerUnit = U
```

If Tasklist/search index is not designed for this, performance and consistency degrade.

Better:

```text
Dedicated work-item projection
├── task id
├── process instance key
├── case id
├── task type
├── assignee
├── candidate group
├── due date
├── priority
├── region
├── risk level
├── status
└── searchable normalized fields
```

### 17.2 Work item projection pattern

```text
Zeebe exported records
        |
        v
Task Projection Builder
        |
        v
work_item table / index
        |
        v
Custom task app query
```

This can coexist with Tasklist.

Use case:

- large enterprise queue,
- complex filters,
- custom security,
- reporting,
- historical workload analytics,
- audit trace.

---

## 18. Stale UI and Concurrency

Human task UI is stale by default.

Examples:

```text
User opens task at 09:00.
Supervisor reassigns at 09:05.
User submits at 09:10.
```

What should happen?

Possible policies:

1. Reject submission because user is no longer assignee.
2. Allow submission if user had task open before reassignment.
3. Ask user to refresh.
4. Supervisor reassignment wins.
5. Task completion wins and reassignment becomes irrelevant.

There is no universal answer.  
You must define it.

### 18.1 Optimistic concurrency

Task completion should carry expected state:

```json
{
  "taskId": "task-123",
  "expectedAssignee": "user-a",
  "expectedTaskVersion": 17,
  "decision": "APPROVE"
}
```

If current task changed:

```text
409 Conflict:
Task was modified. Refresh before continuing.
```

### 18.2 Double submit

User clicks complete twice.

Handle with:

- disabled submit button,
- idempotency key,
- backend duplicate detection,
- task state check,
- friendly UI error.

```json
{
  "idempotencyKey": "task-123:user-a:complete:uuid-789"
}
```

### 18.3 Claim race

Two users claim same task.

Expected behavior:

```text
First successful command wins.
Second receives conflict/rejection.
UI refreshes queue.
```

---

## 19. Human Task Validation

Validation exists at multiple layers:

```text
Form validation
    field required, type, min/max, simple condition.

Backend validation
    user permission, business rule, evidence presence,
    decision consistency, case state.

Process validation
    gateway condition, required variable exists,
    BPMN error if business path invalid.

Domain validation
    invariant enforced by domain service/database.
```

Do not put critical validation only in frontend.

Example:

```text
Decision = APPROVE
Requires:
- all mandatory documents verified
- risk score below threshold or senior approval
- no outstanding clarification
- reviewer has required role
- reviewer is not original submitter
```

This belongs in backend/domain validation, not just form config.

---

## 20. Maker-Checker and Separation of Duties

Common enterprise requirement:

```text
Maker creates or reviews.
Checker approves.
Same person cannot be both.
```

BPMN model:

```text
[Prepare Recommendation]
        |
        v
[Approve Recommendation]
```

Process variables:

```json
{
  "makerUserId": "user-a",
  "checkerUserId": null,
  "recommendation": "APPROVE"
}
```

At checker task:

```text
candidateGroup = senior-approver
forbiddenUserIds contains makerUserId
```

But candidate group alone cannot enforce “not same as maker”.  
Custom task backend or task completion validation must enforce:

```java
if (currentUser.id().equals(processVariables.makerUserId())) {
    throw new ForbiddenException("Maker cannot approve own recommendation");
}
```

Audit event:

```json
{
  "eventType": "CHECKER_DECISION_REJECTED",
  "reason": "SEPARATION_OF_DUTIES",
  "userId": "user-a",
  "caseId": "CASE-001"
}
```

---

## 21. Delegation, Substitution, and Absence Handling

In real organizations, people are absent.

Scenarios:

- officer on leave,
- staff resigned,
- department transfer,
- urgent reassignment,
- delegation during holiday,
- acting supervisor,
- temporary authority.

Design options:

### 21.1 Manual reassignment

Supervisor reassigns tasks.

Pros:

- controlled,
- auditable,
- simple.

Cons:

- manual workload,
- can be late.

### 21.2 Rule-based substitution

```text
If assignee unavailable:
    assign to backup officer.
```

Need:

- absence calendar,
- delegation rule,
- effective date,
- scope,
- audit.

### 21.3 Pool return

```text
Unassign task and return to candidate group.
```

Good for shared queue.

Bad for high-sensitivity cases if ownership matters.

### 21.4 Delegation semantics

Delegation is not always same as reassignment.

```text
Reassignment:
    ownership changes.

Delegation:
    helper performs work but original owner remains accountable.

Substitution:
    acting user temporarily acts as original role.
```

Camunda built-in task operations may not model all organizational semantics deeply enough; custom task app/domain audit may be required.

---

## 22. Task Cancellation and Process Movement

A user task can disappear not because user completed it, but because process moved another way.

Examples:

- interrupting boundary timer fired,
- event subprocess cancelled scope,
- process instance cancelled,
- process modified,
- message event changed path,
- error boundary interrupted activity,
- parent process terminated,
- migration changed instance.

UI must handle:

```text
"This task is no longer active."
```

Not:

```text
"Unknown error."
```

Production behavior:

1. User opens task.
2. Task gets cancelled by process.
3. User submits.
4. Backend receives completion failure.
5. UI explains task was cancelled or no longer available.

---

## 23. Task Completion Semantics

Completing a user task is not “saving a form”.  
Completing task tells the process:

```text
The human obligation is fulfilled. Continue execution.
```

Therefore, before complete:

- validate user authorization,
- validate task state,
- validate form data,
- persist domain decision if needed,
- write audit event,
- ensure evidence references are stable,
- submit variables to Camunda,
- handle command failure.

### 23.1 Complete with variables

Example output variables:

```json
{
  "reviewDecision": "REQUEST_CLARIFICATION",
  "reviewReasonCodes": ["MISSING_DOCUMENT"],
  "reviewedBy": "user-123",
  "reviewedAt": "2026-06-21T10:00:00+08:00"
}
```

### 23.2 Transaction boundary problem

Suppose backend must:

1. Save decision in domain database.
2. Complete Camunda task.

Failure scenarios:

```text
DB save succeeds, Camunda complete fails.
DB save fails, Camunda complete not called.
Camunda complete succeeds, HTTP response to UI fails.
User retries.
```

Possible architecture:

```text
Task completion request
    |
    v
TaskAppBackend
    |
    +-- save decision idempotently
    +-- complete task idempotently
    +-- reconcile if partial failure
```

For critical systems, use completion command idempotency/reconciliation record:

```sql
task_completion_attempt
- attempt_id
- task_id
- user_id
- request_hash
- decision_id
- camunda_command_status
- created_at
- completed_at
```

---

## 24. Draft Save vs Task Complete

Human users often need draft.

But process user task completion is final.

Separate these:

```text
Draft save:
    saves incomplete work in domain/task app database.
    process remains waiting at user task.

Task complete:
    submits final decision/output to process.
    process continues.
```

Do not abuse process variables for every draft keystroke.

Better:

```text
draft_decision table
├── task id
├── user id
├── draft payload
├── version
├── last saved at
└── lock/ownership metadata
```

Final complete sends only validated final output variables to Camunda.

---

## 25. Comments, Notes, and Evidence

Task decisions often require explanations.

Separate:

```text
Decision variables
    structured data driving process.

Comments/notes
    human-readable explanation.

Evidence
    documents/attachments/references.

Audit events
    immutable record of actions.
```

Bad:

```json
{
  "decision": "REJECT",
  "remarks": "not ok"
}
```

Better:

```json
{
  "decision": "REJECT",
  "reasonCodes": [
    "INELIGIBLE_LICENSE_CATEGORY",
    "MISSING_MANDATORY_EXPERIENCE"
  ],
  "remarks": "Applicant does not satisfy minimum experience requirement.",
  "evidenceRefs": [
    "DOC-123",
    "PROFILE-CHECK-456"
  ]
}
```

For regulatory defensibility, reason codes are crucial.

---

## 26. Task Audit Trail

Minimum audit for human task:

```text
task created
task visible to group
task claimed
task assigned
task reassigned
task returned
task viewed
form opened
draft saved
evidence added
decision submitted
task completed
task cancelled
task escalated
deadline changed
override performed
```

Each audit event should capture:

```json
{
  "eventId": "AUD-001",
  "eventType": "TASK_COMPLETED",
  "caseId": "CASE-001",
  "taskId": "TASK-123",
  "processInstanceKey": "2251799813685251",
  "bpmnElementId": "ReviewApplication",
  "actorUserId": "user-123",
  "actorRole": "APPLICATION_REVIEWER",
  "timestamp": "2026-06-21T10:00:00+08:00",
  "decision": "APPROVE",
  "reasonCodes": ["ALL_REQUIREMENTS_MET"],
  "sourceIp": "10.0.0.10",
  "correlationId": "corr-789"
}
```

For sensitive cases:

- record impersonation/substitution,
- record supervisor override,
- record conflict-of-interest check result,
- record role at time of decision,
- record data snapshot/reference.

---

## 27. Custom Read Model for Human Work

Camunda Tasklist is useful, but not always sufficient for enterprise reporting.

A custom read model may be needed:

```text
work_item
├── id
├── case_id
├── process_instance_key
├── task_key
├── task_name
├── task_type
├── bpmn_element_id
├── state
├── assignee
├── candidate_groups
├── priority
├── due_at
├── follow_up_at
├── created_at
├── completed_at
├── region
├── risk_level
├── case_status
├── current_queue
├── tenant_id
└── last_projection_event_position
```

This enables:

- operational dashboards,
- supervisor queues,
- aging reports,
- SLA reports,
- cross-process task search,
- regulatory evidence,
- workload balancing.

Important: custom read model must tolerate:

- duplicate exported events,
- out-of-order across partitions,
- replay,
- projection rebuild,
- partial projection failure.

---

## 28. Workload Analytics

Human task management needs metrics:

```text
Volume
├── tasks created per day
├── tasks completed per day
├── open tasks
├── overdue tasks
└── backlog by queue

Time
├── average handling time
├── median handling time
├── p95 handling time
├── wait time before claim
└── time in assignee state

Quality
├── rejection rate
├── rework rate
├── returned task count
├── escalation count
└── override count

People/team
├── assigned count per user
├── completed count per user
├── overdue by user/team
├── workload imbalance
└── capacity forecast
```

Be careful: metrics can create bad incentives.

Example:

```text
If you measure only "tasks completed",
users may rush low-quality decisions.

If you measure only "overdue count",
users may avoid complex cases.

If you measure only "average time",
high-risk tasks appear as poor performance.
```

Better:

```text
Measure:
- task complexity,
- risk level,
- rework rate,
- decision quality,
- SLA compliance,
- supervisor override,
- appeal outcome.
```

---

## 29. Task Ownership Models

### 29.1 Pull model

Users claim tasks from queue.

Pros:

- flexible,
- simple,
- self-service.

Cons:

- cherry-picking,
- unfair distribution,
- high-priority tasks may be ignored.

### 29.2 Push model

System/supervisor assigns tasks.

Pros:

- controlled,
- fairer allocation,
- skill-aware.

Cons:

- requires routing logic,
- may overload users,
- less autonomy.

### 29.3 Hybrid model

```text
High-risk tasks: push assignment.
Low-risk tasks: pull from queue.
Overdue tasks: supervisor controlled.
```

This is often best.

---

## 30. Cherry-Picking and Queue Fairness

In shared queues, users may pick easy tasks.

Signs:

- difficult tasks age,
- high-risk tasks pile up,
- some users take only low-priority tasks,
- SLA breaches cluster by task type,
- supervisor manually rescues backlog.

Mitigations:

1. Auto-assignment.
2. Priority ordering enforced by UI.
3. Limit visible tasks to top N by policy.
4. Complexity-adjusted workload scoring.
5. Supervisor dashboard.
6. Randomized assignment within eligible pool.
7. Weighted routing.
8. Explicit escalation for aging tasks.

Example workload score:

```text
score = assignedTaskCount
      + highRiskTaskCount * 2
      + overdueTaskCount * 3
      - capacityAdjustment
```

---

## 31. Bulk Actions

Enterprise users often request bulk approve/reject/assign.

Be careful.

Bulk actions are safe when:

- tasks are homogeneous,
- decision rule is identical,
- no individualized evidence needed,
- audit can capture batch rationale,
- process can handle burst continuation.

Bulk actions are dangerous when:

- each task needs individual judgment,
- evidence differs,
- high-risk cases included,
- process downstream creates massive load,
- user may accidentally approve hundreds of cases.

Design bulk operations with:

```text
preview
filter confirmation
sample validation
dry-run count
reason required
audit batch id
rate limiting
partial failure report
undo/compensation policy
```

---

## 32. Notifications

Tasklist UI alone is not enough.

Notification channels:

- email,
- Slack/Teams,
- in-app notification,
- dashboard badge,
- supervisor report,
- daily digest,
- escalation alert.

Notification event types:

```text
TASK_ASSIGNED
TASK_DUE_SOON
TASK_OVERDUE
TASK_RETURNED
TASK_ESCALATED
TASK_REASSIGNED
TASK_COMMENTED
TASK_COMPLETED
```

Avoid notification spam.

Good notification design:

```text
Notify when action is needed,
aggregate when possible,
escalate only when meaningful,
include direct link/context,
avoid exposing sensitive data.
```

---

## 33. Human Task Security

Threats:

1. User sees unauthorized task.
2. User completes task outside role.
3. User modifies hidden variables.
4. User submits forged decision.
5. User accesses another tenant's task.
6. User replays complete request.
7. User escalates task without permission.
8. User changes assignee maliciously.
9. Sensitive process variables leak through form.
10. Audit trail can be tampered with.

Controls:

```text
Authentication
Authorization
Tenant isolation
Backend validation
CSRF protection for browser app
Idempotency token
Input allowlist
Output variable allowlist
Audit immutability
Field-level security
Secure document access
Least-privilege Camunda API token
```

### 33.1 Output variable allowlist

Bad:

```text
Accept arbitrary JSON from browser and submit to process.
```

Better:

```java
Map<String, Object> output = Map.of(
    "reviewDecision", request.decision(),
    "reviewReasonCodes", request.reasonCodes(),
    "reviewedBy", currentUser.id(),
    "reviewedAt", clock.now()
);
```

The backend decides which variables can be written.

---

## 34. PII and Sensitive Data in Task UI

Human tasks often expose personal/sensitive data.

Principles:

1. Minimize data in Camunda variables.
2. Use references to domain data.
3. Apply field-level masking.
4. Audit sensitive view access.
5. Avoid putting secrets in variables.
6. Avoid embedding documents in variables.
7. Respect retention policy.
8. Ensure screenshots/exported data risk is considered.

Example:

```json
{
  "applicantName": "Jane Doe",
  "maskedIdentifier": "S****123A",
  "profileRef": "PROFILE-123",
  "documentBundleRef": "DOCB-456"
}
```

Task UI fetches full sensitive profile only if user is authorized.

---

## 35. Multi-Tenancy and Organizational Isolation

Task management often crosses tenant/team boundaries.

Isolation dimensions:

```text
tenant
organization
agency
department
team
region
role
case type
data classification
```

Do not assume one `candidateGroup` can express all isolation rules.

Example:

```text
User is in group "reviewer"
but can only review:
- tenant = CEA
- region = EAST
- case type = SALESPERSON_RENEWAL
- risk <= MEDIUM
- not assigned to own submission
```

This is ABAC.

Design:

```text
TaskAuthorizationPolicy
├── hasProcessPermission
├── hasTenantAccess
├── hasQueueAccess
├── hasCaseAccess
├── hasRequiredRole
├── passesConflictCheck
├── passesDataClassificationCheck
└── canPerformAction(action)
```

---

## 36. Human Task + Case Management

Regulatory workflows rarely fit pure BPMN alone.

A case has:

```text
Case
├── lifecycle state
├── parties
├── documents
├── correspondence
├── evidence
├── risk
├── timeline
├── tasks
├── decisions
├── appeals
└── enforcement actions
```

Camunda process controls long-running flow.  
Domain case service owns case aggregate.

```text
Camunda process:
    "what stage should happen next?"

Case service:
    "what is the authoritative case state and evidence?"

Task app:
    "what should this officer do now?"
```

Avoid making process variables the case database.

---

## 37. Design Pattern: Task App Backend Completion Flow

```text
Browser submits decision
        |
        v
TaskAppBackend.completeReviewTask()
        |
        +-- authenticate user
        +-- load task from Camunda/Task API
        +-- check task active
        +-- check current assignee/claim
        +-- load case context
        +-- enforce authorization
        +-- validate decision
        +-- persist domain decision idempotently
        +-- write audit pre-completion event
        +-- complete Camunda task with output variables
        +-- write audit post-completion event
        +-- return success / conflict / retryable failure
```

Pseudo-code:

```java
public CompleteTaskResponse completeReviewTask(
        String taskId,
        ReviewDecisionRequest request,
        CurrentUser user
) {
    Task task = taskGateway.getTask(taskId)
            .orElseThrow(() -> new NotFoundException("Task not found"));

    taskPolicy.assertCanComplete(task, user);

    CaseRecord caseRecord = caseRepository.getByProcessInstanceKey(
            task.processInstanceKey()
    );

    reviewPolicy.validateDecision(caseRecord, request, user);

    CompletionAttempt attempt = completionAttemptService.startOrReplay(
            taskId,
            user.id(),
            request.idempotencyKey(),
            request.requestHash()
    );

    if (attempt.alreadyCompleted()) {
        return CompleteTaskResponse.replayed(attempt.result());
    }

    Decision decision = decisionService.saveReviewDecision(
            caseRecord.id(),
            taskId,
            user.id(),
            request
    );

    auditService.record(TaskAuditEvent.decisionSubmitted(
            taskId,
            caseRecord.id(),
            user.id(),
            decision.id()
    ));

    Map<String, Object> variables = ReviewTaskVariables.output(
            decision,
            user,
            clock.instant()
    );

    taskGateway.complete(taskId, variables);

    completionAttemptService.markCompleted(attempt.id(), decision.id());

    auditService.record(TaskAuditEvent.taskCompleted(
            taskId,
            caseRecord.id(),
            user.id()
    ));

    return CompleteTaskResponse.success(decision.id());
}
```

Key point: Camunda command is only one step in a controlled business transaction boundary.

---

## 38. Pattern: Task Routing Worker

Sometimes task assignment should happen automatically.

BPMN:

```text
[User Task: Review Application]
```

Task created with candidate group. A separate routing service observes task creation and assigns.

```text
Task Routing Service
├── observes new tasks
├── reads task metadata
├── reads user capacity
├── applies routing rules
├── assigns task
└── writes assignment audit
```

Routing rules:

```text
if risk = HIGH:
    assign senior reviewer
else if region = EAST:
    assign east queue reviewer
else:
    assign general queue
```

Potential sources:

- Tasklist API polling,
- exported record projection,
- custom work item table,
- domain event from case service.

Be careful with race conditions between user self-claim and auto-assignment.

---

## 39. Pattern: External Work Item Projection

For large organizations:

```text
Zeebe user task records
       |
       v
Projection Consumer
       |
       v
work_item table
       |
       v
Task App Backend
       |
       v
Camunda complete/assign command
```

Advantages:

- custom search,
- stable reporting,
- queue-specific filters,
- join with domain data,
- custom authorization,
- fast dashboard,
- resilient UI even if Tasklist UI is not used.

Risks:

- projection lag,
- duplicate events,
- consistency complexity,
- need replay logic,
- schema migration,
- not source of truth.

Rule:

```text
Use custom projection for query and dashboard.
Use Camunda command API for task lifecycle changes.
```

---

## 40. Pattern: Human Decision as Domain Event

When a user completes a task, do not only store process variable.

Emit a domain event:

```json
{
  "eventType": "APPLICATION_REVIEWED",
  "applicationId": "APP-001",
  "decision": "APPROVE",
  "reviewerId": "user-123",
  "reasonCodes": ["ALL_REQUIREMENTS_MET"],
  "occurredAt": "2026-06-21T10:30:00+08:00"
}
```

This supports:

- audit,
- reporting,
- downstream notification,
- evidence,
- appeal review,
- data warehouse,
- process mining.

Camunda variable is for process continuation.  
Domain event is for business history.

---

## 41. Pattern: Escalation with Supervisor Task

```text
Review Application User Task
    |
    | non-interrupting timer due soon
    v
Notify Reviewer

Review Application User Task
    |
    | interrupting timer overdue
    v
Supervisor Escalation Task
```

Supervisor task input:

```json
{
  "originalTaskId": "TASK-123",
  "originalAssignee": "user-a",
  "dueAt": "2026-06-21T17:00:00+08:00",
  "overdueMinutes": 180,
  "caseId": "CASE-001"
}
```

Supervisor outputs:

```json
{
  "escalationDecision": "REASSIGN",
  "newAssignee": "user-b",
  "escalationRemarks": "Original reviewer unavailable."
}
```

---

## 42. Pattern: Task Locking Beyond Claim

Claim is not always enough.

For complex task UI:

- user opens task,
- user edits draft for 30 minutes,
- another supervisor reassigns,
- another user tries to work same task.

You may need application-level editing lock.

```text
task_edit_lock
├── task_id
├── locked_by
├── locked_until
├── lock_version
└── reason
```

Policy:

- claim = ownership,
- lock = active editing session,
- draft = incomplete work,
- complete = final process transition.

Do not confuse them.

---

## 43. Anti-Patterns

### 43.1 Treating Tasklist as authoritative state store

Bad:

```text
Tasklist says no task, therefore process has no task.
```

Better:

```text
Tasklist is projection; verify command/read consistency when needed.
```

### 43.2 Candidate group as security

Bad:

```text
candidateGroup = "admin", so only admins can access.
```

Better:

```text
candidate group routes; authorization enforces.
```

### 43.3 Arbitrary variable submission from frontend

Bad:

```text
Browser submits JSON; backend forwards all variables to Camunda.
```

Better:

```text
Backend maps approved fields only.
```

### 43.4 No task completion idempotency

Bad:

```text
User retries after timeout; duplicate domain decision created.
```

Better:

```text
Completion attempt table + idempotency key + result replay.
```

### 43.5 Using user task for machine wait

Bad:

```text
Create user task "Wait for API response".
```

Better:

```text
Use message/timer/event pattern.
```

### 43.6 Using service task for human work

Bad:

```text
Worker waits for human approval by sleeping/polling.
```

Better:

```text
Use user task or message wait.
```

### 43.7 One global queue for everything

Bad:

```text
All tasks in "operations".
```

Better:

```text
queue by role/risk/case type/team/SLA.
```

### 43.8 No reason codes

Bad:

```text
Approve/reject with free text only.
```

Better:

```text
structured decision + reason codes + remarks.
```

### 43.9 Process variables as case database

Bad:

```text
Store all applicant data, documents, and audit inside process variables.
```

Better:

```text
Store references and decision variables; domain service owns case data.
```

### 43.10 Ignoring stale UI

Bad:

```text
Complete failure shows generic error.
```

Better:

```text
Explain task already claimed/completed/cancelled/reassigned.
```

---

## 44. Failure Case Studies

### 44.1 Duplicate approval after browser retry

Flow:

```text
User submits approval.
Backend saves decision.
Camunda complete command times out.
User clicks submit again.
Backend saves second decision.
```

Root cause:

- no idempotency key,
- no completion attempt record,
- timeout interpreted as failure,
- domain save not deduplicated.

Fix:

- idempotency key per completion request,
- unique constraint on `task_id + decision_type`,
- result replay,
- reconciliation job.

---

### 44.2 Unauthorized completion due to frontend-only check

Flow:

```text
Frontend hides task from unauthorized user.
User calls API directly with task ID.
Backend forwards complete command.
Task completes.
```

Root cause:

- backend trusted frontend,
- no task authorization check,
- Camunda API credential too broad.

Fix:

- backend authorization policy,
- per-action checks,
- least-privilege API access,
- audit unauthorized attempts.

---

### 44.3 Task disappears from Tasklist but process still active

Flow:

```text
User claims task.
Tasklist projection lags or import issue.
Task not visible.
Process still waiting.
```

Root cause:

- read-side projection issue,
- support team treats Tasklist as source of truth.

Fix:

- distinguish engine state vs projection,
- inspect Operate/API,
- monitor importer/exporter lag,
- run projection recovery playbook.

---

### 44.4 Overdue explosion

Flow:

```text
Hundreds of tasks created with 2-day due date.
No supervisor dashboard.
Users cherry-pick easy tasks.
Complex tasks breach SLA.
```

Root cause:

- queue design too naive,
- no complexity/risk routing,
- no aging alert,
- no workload balancing.

Fix:

- SLA dashboard,
- auto-assignment for high-risk tasks,
- aging priority,
- escalation timer,
- team capacity report.

---

### 44.5 Wrong person approves due to group ambiguity

Flow:

```text
candidateGroup = "manager"
Different departments have "manager".
User from wrong department claims task.
```

Root cause:

- group name too broad,
- no tenant/department/case-level authorization,
- candidate group treated as full policy.

Fix:

- qualified group names,
- tenant-aware authorization,
- case-aware task backend policy,
- ABAC.

---

## 45. Java-Oriented Design: Gateway Interfaces

In a Java custom task app, isolate Camunda API behind ports.

```java
public interface HumanTaskGateway {
    Optional<HumanTask> findById(String taskId);

    Page<HumanTaskSummary> search(TaskSearchCriteria criteria);

    void claim(String taskId, String userId);

    void assign(String taskId, String assigneeUserId);

    void unassign(String taskId);

    void complete(String taskId, Map<String, Object> variables);
}
```

Domain-level service:

```java
public final class ReviewTaskApplicationService {

    private final HumanTaskGateway taskGateway;
    private final ReviewPolicy reviewPolicy;
    private final CaseRepository caseRepository;
    private final DecisionRepository decisionRepository;
    private final AuditService auditService;

    public ReviewTaskApplicationService(
            HumanTaskGateway taskGateway,
            ReviewPolicy reviewPolicy,
            CaseRepository caseRepository,
            DecisionRepository decisionRepository,
            AuditService auditService
    ) {
        this.taskGateway = taskGateway;
        this.reviewPolicy = reviewPolicy;
        this.caseRepository = caseRepository;
        this.decisionRepository = decisionRepository;
        this.auditService = auditService;
    }

    public void completeReview(String taskId, ReviewCommand command, CurrentUser user) {
        HumanTask task = taskGateway.findById(taskId)
                .orElseThrow(() -> new TaskNotFoundException(taskId));

        reviewPolicy.assertCanComplete(task, user);

        CaseRecord caseRecord = caseRepository.getByProcessInstanceKey(
                task.processInstanceKey()
        );

        ReviewDecision decision = reviewPolicy.validateAndCreateDecision(
                caseRecord,
                command,
                user
        );

        decisionRepository.save(decision);

        auditService.recordReviewDecision(task, caseRecord, decision, user);

        taskGateway.complete(taskId, Map.of(
                "reviewDecision", decision.value().name(),
                "reviewReasonCodes", decision.reasonCodes(),
                "reviewedBy", user.id(),
                "reviewedAt", decision.reviewedAt().toString()
        ));
    }
}
```

Important: the application service expresses business semantics; the Camunda API adapter is infrastructure.

---

## 46. Testing Human Task Workflows

Test categories:

### 46.1 BPMN path tests

- task is created at expected point,
- correct variables are passed,
- completion continues to right gateway path,
- boundary timer escalation works,
- cancellation cancels active task.

### 46.2 Task app backend tests

- unauthorized user cannot view,
- unauthorized user cannot complete,
- assignee can complete,
- candidate can claim,
- maker cannot checker,
- stale task conflict handled,
- duplicate submit idempotent,
- invalid decision rejected.

### 46.3 Projection tests

- task created event updates work item,
- assignment event updates assignee,
- completion event marks task done,
- replay does not duplicate,
- out-of-order cross-partition data handled.

### 46.4 UI tests

- claim race shows refresh message,
- complete success updates queue,
- stale completion shows meaningful error,
- required evidence validation shown,
- overdue status visible.

### 46.5 Security tests

- direct API call unauthorized,
- variable injection blocked,
- cross-tenant access blocked,
- field-level masking enforced.

---

## 47. Production Readiness Checklist

### 47.1 Task modelling

- [ ] User task has clear purpose.
- [ ] Task name is business-readable.
- [ ] Task has expected input/output contract.
- [ ] Task is not used for machine wait.
- [ ] Task output variables are versioned.
- [ ] Task completion path is tested.

### 47.2 Assignment

- [ ] Assignee/candidate group semantics are defined.
- [ ] Candidate groups are not assumed to be full authorization unless verified.
- [ ] Claim/assign/return/unassign semantics are documented.
- [ ] Reassignment requires audit reason.
- [ ] Absence/delegation handling exists.
- [ ] Maker-checker constraints are enforced if needed.

### 47.3 Authorization

- [ ] Backend enforces task access.
- [ ] Tenant isolation is enforced.
- [ ] Case-level permission is enforced.
- [ ] Conflict-of-interest rule is enforced.
- [ ] Variable output allowlist exists.
- [ ] API token is least-privilege.

### 47.4 SLA and escalation

- [ ] Due date calculation is defined.
- [ ] Business calendar rules are clear.
- [ ] Follow-up date semantics are clear.
- [ ] Overdue handling exists.
- [ ] Escalation path exists.
- [ ] SLA pause/resume rule exists if applicable.

### 47.5 UX and concurrency

- [ ] Stale task errors are user-friendly.
- [ ] Claim race handled.
- [ ] Double submit handled.
- [ ] Draft save separated from complete.
- [ ] Task cancellation handled.
- [ ] Bulk actions protected.

### 47.6 Audit and compliance

- [ ] Task lifecycle audit exists.
- [ ] Decision reason codes captured.
- [ ] Evidence references captured.
- [ ] Assignment changes audited.
- [ ] Override audited.
- [ ] Sensitive data view audited.
- [ ] Audit events immutable or tamper-evident.

### 47.7 Operations

- [ ] Supervisor dashboard exists.
- [ ] Backlog metrics exist.
- [ ] Overdue alerts exist.
- [ ] Projection lag monitored.
- [ ] Task API failures monitored.
- [ ] Runbook exists for stuck tasks.

---

## 48. Design Review Questions

Use these questions when reviewing human workflow design:

1. What exactly is the human expected to decide?
2. What data does the human need?
3. What data should the human not see?
4. Who may see this task?
5. Who may claim this task?
6. Who may complete this task?
7. Can the same user perform previous and current step?
8. What happens if nobody claims it?
9. What happens if assignee is absent?
10. What happens if task is overdue?
11. What happens if user submits stale task?
12. What happens if user double-submits?
13. What happens if Camunda complete command times out?
14. Is task completion idempotent?
15. Is decision stored as structured data?
16. Are reason codes captured?
17. Are evidence references captured?
18. Is audit sufficient for external challenge?
19. Can supervisor see backlog?
20. Can operations explain why SLA was breached?
21. Is Tasklist enough or do we need custom task app?
22. Is candidate group actually enforced authorization in this version/config?
23. Are task variables too large or too sensitive?
24. Can task search scale?
25. Is projection lag considered?

---

## 49. Practical Architecture Recommendation

For small/simple workflows:

```text
Camunda Tasklist
+ Camunda Forms
+ standard assignment
+ simple due dates
+ Operate for support
```

For medium enterprise workflows:

```text
Tasklist or lightweight custom app
+ backend authorization
+ domain validation
+ task completion audit
+ SLA dashboard
+ structured decision variables
```

For complex regulatory/case workflows:

```text
Custom case/task application
+ Camunda 8 as orchestration engine
+ Tasklist optionally for operations/fallback
+ custom work item projection
+ domain case service
+ document/evidence service
+ audit service
+ ABAC authorization
+ SLA/deadline service
+ supervisor dashboard
+ reconciliation jobs
```

A strong architecture does not force every human workflow into Tasklist.  
It uses Tasklist where it fits and builds controlled extensions where business complexity requires it.

---

## 50. Key Takeaways

1. Tasklist is a human work surface, not the Zeebe source of truth.
2. User task is a human work contract, not just a form.
3. Assignment metadata and authorization policy must be separated.
4. Candidate groups are useful for routing, but security must be verified per version/configuration.
5. Human task completion must be validated, auditable, and idempotent.
6. Stale UI and claim race are normal distributed system problems.
7. SLA and escalation require explicit business semantics.
8. Custom task apps are often necessary for complex enterprise/regulatory work.
9. Process variables should not become a case database.
10. Human workflow at scale requires queue design, workload analytics, audit, and operational runbooks.
11. For top-level engineering, human task design is not frontend work; it is distributed workflow, security, audit, and organizational process engineering.

---

## 51. References

The material in this part is aligned with the following Camunda documentation and concepts:

- Camunda 8 User tasks documentation: https://docs.camunda.io/docs/components/modeler/bpmn/user-tasks/
- Camunda 8 Tasklist user guide: https://docs.camunda.io/docs/components/tasklist/userguide/using-tasklist/
- Camunda 8 Tasklist API overview: https://docs.camunda.io/docs/apis-tools/tasklist-api-rest/tasklist-api-rest-overview/
- Camunda 8 Task API controller: https://docs.camunda.io/docs/apis-tools/tasklist-api-rest/controllers/tasklist-api-rest-task-controller/
- Camunda 8 User task lifecycle: https://docs.camunda.io/docs/apis-tools/frontend-development/task-applications/user-task-lifecycle/
- Camunda 8 Tasklist self-managed configuration: https://docs.camunda.io/docs/8.7/self-managed/tasklist-deployment/tasklist-configuration/
- Camunda 8 reference architecture: https://docs.camunda.io/docs/self-managed/reference-architecture/
- Camunda 8 secondary storage/exporter concepts: https://docs.camunda.io/docs/self-managed/concepts/exporters/

---

## 52. Penutup Part 019

Pada bagian ini kita memperdalam human task management dari sudut production architecture:

- Tasklist sebagai projection-driven work surface,
- user task sebagai human work contract,
- assignment dan authorization sebagai concern berbeda,
- queue/workload/SLA sebagai masalah operasi,
- custom task app sebagai kebutuhan realistis untuk workflow kompleks,
- audit dan idempotency sebagai syarat defensibility.

Bagian berikutnya akan melanjutkan ke:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-020.md
```

Dengan judul:

```text
Part 020 — Optimize, Process Analytics, Bottleneck Detection, and Feedback Loop Engineering
```

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-018.md">⬅️ Part 018 — Operate Deep Dive: Incident Triage, Process Instance Debugging, and Production Support</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-020.md">Part 020 — Optimize, Process Analytics, Bottleneck Detection, and Feedback Loop Engineering ➡️</a>
</div>
