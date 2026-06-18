# learn-java-bpmn-camunda-process-orchestration-engineering

# Part 10 — Human Workflow: User Task, Assignment, Forms, SLA, and Authorization

> Seri: `learn-java-bpmn-camunda-process-orchestration-engineering`  
> Part: `10`  
> Topik: human workflow, user task, assignment, form, SLA, authorization, maker-checker, auditability  
> Target: Java engineer yang ingin mampu mendesain workflow manusia yang production-grade, auditable, secure, dan maintainable  
> Java coverage: Java 8 sampai Java 25  
> Fokus engine: BPMN 2.0, Camunda 8, Camunda 7 sebagai perbandingan bila relevan

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu harus bisa:

1. Memahami user task bukan sebagai “screen” atau “status”, tetapi sebagai **wait state yang membutuhkan keputusan/aksi manusia**.
2. Mendesain assignment, candidate group, claim, complete, reassign, delegation, dan escalation dengan mental model yang benar.
3. Membedakan **task visibility**, **task ownership**, **task permission**, dan **domain authorization**.
4. Mendesain form workflow tanpa menjadikan process variable sebagai database kedua.
5. Mendesain SLA berbasis due date, follow-up date, timer, reminder, escalation, dan aging queue.
6. Menerapkan maker-checker/four-eyes principle secara defensible.
7. Menghubungkan Camunda Tasklist/custom task application dengan Java backend secara aman.
8. Menghindari anti-pattern human workflow yang umum: task sebagai status table, direct variable tampering, role hardcode, dan audit yang tidak cukup.
9. Mendesain human workflow untuk regulatory/case-management system: assignment pool, supervisor review, reassignment, SLA breach, reason code, dan evidence trail.

---

## 1. Core Mental Model: User Task adalah Wait State Manusia

Dalam workflow engine, service task biasanya berarti:

```text
engine membuat job
worker mengambil job
worker menjalankan logic
worker menyelesaikan job
process lanjut
```

User task berbeda:

```text
engine mencapai user task
engine membuat task untuk manusia/aplikasi task UI
process berhenti di wait state
manusia melihat/mengambil/mengerjakan task
aplikasi mengirim complete task
process lanjut
```

Jadi user task bukan sekadar “halaman form”. User task adalah **kontrak runtime** bahwa process tidak boleh lanjut sampai ada aksi manusia yang valid.

Mental model sederhana:

```text
Process Instance
  |
  v
[Review Application]
  |
  |-- wait for human decision
  |-- expose work item to task list
  |-- enforce assignment/authorization externally or through platform
  |-- collect decision data
  |-- record completion
  v
Next BPMN element
```

Dalam sistem regulatory, user task sering mewakili hal serius:

- officer melakukan assessment;
- supervisor menyetujui rekomendasi;
- applicant melengkapi dokumen;
- compliance team melakukan investigation review;
- legal team memberikan clearance;
- agency lain memberikan concurrence;
- finance team memverifikasi payment;
- admin melakukan manual correction.

Kesalahan besar adalah menganggap user task sebagai “to-do list biasa”. Dalam enterprise/regulatory system, user task adalah titik keputusan, tanggung jawab, accountability, dan audit.

---

## 2. User Task vs Domain Status

Misalnya ada aplikasi lisensi dengan status domain:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
PENDING_CLARIFICATION
APPROVED
REJECTED
WITHDRAWN
EXPIRED
```

Lalu ada user task BPMN:

```text
Review Application
Request Clarification
Approve Recommendation
Verify Payment
Issue Licence
```

Keduanya tidak sama.

### 2.1 Domain Status

Domain status adalah keadaan business entity.

Contoh:

```text
Application.status = UNDER_REVIEW
```

Status ini dipakai untuk:

- business rule;
- UI state;
- reporting;
- search/filter;
- authorization;
- downstream integration;
- legal/audit record.

### 2.2 User Task

User task adalah pekerjaan yang harus dilakukan agar process dapat lanjut.

Contoh:

```text
Task: Review Application
Candidate group: licensing-officer
Due date: 2026-06-24T17:00:00+08:00
Assignee: officerA
```

Task dipakai untuk:

- work queue;
- assignment;
- claim;
- completion;
- SLA tracking;
- operational visibility;
- waiting point in process.

### 2.3 Hubungan yang Benar

Hubungan yang sehat:

```text
Domain entity stores legally meaningful state.
Process instance coordinates lifecycle.
User task represents work needed at one point in lifecycle.
```

Contoh:

```text
Application.status = UNDER_REVIEW
Process waits at: Review Application user task
Task assigned to: licensing officer
```

Ketika task selesai:

```text
Officer decision = REQUEST_CLARIFICATION
Application.status = PENDING_CLARIFICATION
Process moves to: Request Applicant Clarification
```

### 2.4 Anti-pattern: User Task sebagai Status Table

Buruk:

```text
Kalau task Review Application masih ada, berarti status = UNDER_REVIEW.
Kalau task tidak ada, berarti sudah selesai.
Kalau task A ada dan task B tidak ada, berarti applicant belum submit.
```

Kenapa buruk?

Karena task adalah runtime artifact, bukan domain truth.

Masalah:

- task bisa di-cancel oleh process migration;
- task bisa selesai tapi domain update gagal;
- ada multiple task paralel;
- task history mungkin di-retention/archival;
- task name bisa berubah;
- audit business menjadi bergantung pada engine internals;
- reporting menjadi rapuh.

Prinsip:

```text
Never derive legal/domain state solely from the existence of a workflow task.
```

---

## 3. Lifecycle User Task

Secara konseptual, user task memiliki lifecycle seperti ini:

```text
CREATED
  |
  | visible to candidate users/groups
  v
AVAILABLE / UNASSIGNED
  |
  | claim / assign
  v
ASSIGNED
  |
  | work starts
  | save draft / update data / add comments
  | complete / reassign / unassign / cancel
  v
COMPLETED / CANCELLED
```

Dalam proses nyata, lifecycle bisa lebih kaya:

```text
CREATED
AVAILABLE
CLAIMED
IN_PROGRESS
PENDING_INFO
RETURNED
REASSIGNED
ESCALATED
COMPLETED
CANCELLED
```

Namun hati-hati: tidak semua state ini harus menjadi BPMN element. Sebagian cukup menjadi metadata task atau domain worklog.

### 3.1 Created

Engine mencapai user task dan membuat task.

Pada titik ini biasanya ditentukan:

- task name;
- candidate users;
- candidate groups;
- assignee;
- due date;
- follow-up date;
- priority;
- form reference;
- custom headers/metadata;
- input variables.

### 3.2 Available / Unassigned

Task terlihat oleh candidate user/group tetapi belum dipegang individu tertentu.

Contoh:

```text
Task: Review Application
Candidate group: licensing-officer
Assignee: null
```

Semua officer yang punya group tersebut dapat melihat task di queue.

### 3.3 Claimed / Assigned

Seorang user mengambil task.

```text
Assignee = officerA
```

Setelah assigned, biasanya hanya officerA yang dapat complete, kecuali supervisor/admin punya permission tertentu.

### 3.4 In Progress

User membuka task, membaca data, mengubah draft, upload dokumen, menambahkan komentar, meminta klarifikasi internal, dan lain-lain.

Banyak engine tidak otomatis punya state `IN_PROGRESS`; aplikasi perlu memutuskan apakah ini perlu dicatat sebagai domain worklog.

### 3.5 Completed

Task selesai dan process lanjut.

Completion harus membawa outcome yang jelas:

```json
{
  "reviewDecision": "APPROVE",
  "reviewReasonCode": "ALL_REQUIREMENTS_MET",
  "reviewComment": "Applicant meets all criteria.",
  "reviewedBy": "officerA",
  "reviewedAt": "2026-06-17T09:25:00+07:00"
}
```

Namun tidak semua data harus menjadi process variable. Data yang legal/audit-critical harus masuk domain database/audit table.

### 3.6 Cancelled

Task bisa hilang karena:

- boundary event interrupting;
- process cancellation;
- terminate end event;
- migration;
- subprocess cancellation;
- alternative path dipilih.

Ketika task dibatalkan, perlu jelas:

```text
Apakah user perlu diberitahu?
Apakah draft pekerjaan harus disimpan?
Apakah domain status berubah?
Apakah audit mencatat cancellation reason?
```

---

## 4. Assignment Model

Assignment adalah salah satu sumber complexity terbesar dalam human workflow.

Ada beberapa mode:

1. direct assignee;
2. candidate user;
3. candidate group;
4. dynamic assignment;
5. rule-based assignment;
6. load-balanced assignment;
7. skill-based assignment;
8. jurisdiction/team-based assignment;
9. supervisor assignment;
10. self-service claim.

---

## 5. Direct Assignee

Direct assignee berarti task langsung diberikan kepada user tertentu.

```text
Task: Approve Recommendation
Assignee: supervisorA
```

Cocok untuk:

- task yang sudah jelas pemiliknya;
- follow-up ke officer sebelumnya;
- supervisor dari officer yang submit;
- applicant yang sama;
- designated case owner.

Tidak cocok untuk:

- work pool besar;
- high volume queue;
- task yang perlu load balancing;
- task yang harus tetap bisa dikerjakan saat user cuti.

Risiko direct assignee:

- bottleneck pada satu user;
- task stuck saat assignee tidak available;
- sulit redistribusi;
- assignment logic hardcoded;
- authorization keliru jika assignee berubah role.

Pattern yang lebih sehat:

```text
Candidate group = licensing-supervisor
Assignee = resolvedSupervisor(caseOwner)
Fallback = supervisor pool
Escalation = head of unit after SLA breach
```

---

## 6. Candidate User

Candidate user berarti task dapat di-claim oleh satu atau beberapa user tertentu.

```text
Candidate users: officerA, officerB, officerC
```

Cocok untuk:

- small team;
- committee review;
- task yang hanya boleh dikerjakan subset user tertentu;
- replacement pool sementara.

Risiko:

- daftar user bisa stale;
- user pindah role;
- user resign;
- candidate list terlalu panjang;
- sulit dikelola jika langsung di-BPMN expression.

Lebih baik candidate user sering dihitung dari assignment service:

```text
assignmentService.findEligibleOfficers(applicationId, taskType)
```

---

## 7. Candidate Group

Candidate group berarti task tersedia untuk semua user dalam group/role tertentu.

```text
Candidate group: licensing-officer
```

Cocok untuk:

- pooled work queue;
- role-based task visibility;
- high volume operation;
- team-based processing.

Namun candidate group bukan otomatis authorization domain yang lengkap. Kamu masih perlu memikirkan:

```text
Apakah user dalam group ini boleh melihat semua application?
Apakah ada jurisdiction constraint?
Apakah ada conflict-of-interest constraint?
Apakah user boleh complete, atau hanya view?
Apakah user boleh claim task milik orang lain?
```

Contoh buruk:

```text
candidateGroup = "officer"
```

Semua officer bisa melihat semua case dari semua region, semua sensitivity level, semua agency.

Contoh lebih baik:

```text
candidateGroup = "licensing-officer"
additional domain authorization:
  region = application.region
  agency = application.agency
  clearanceLevel >= application.sensitivityLevel
  no conflict-of-interest
```

Dalam regulatory platform, group hampir tidak pernah cukup. Group harus digabung dengan domain authorization.

---

## 8. Dynamic Assignment

Dynamic assignment menggunakan expression/variable/service untuk menentukan assignee/candidate.

Contoh:

```text
assignee = ${caseOwnerUserId}
candidateGroups = ${reviewCandidateGroups}
dueDate = ${reviewDueDate}
```

Atau melalui worker sebelum user task:

```text
[Determine Assignment]
  -> sets candidateGroups, assignee, dueDate, priority
[Review Application]
```

Pattern ini lebih testable dibanding expression yang terlalu kompleks di BPMN.

### 8.1 Assignment Worker Pattern

```text
Start
  -> Validate Submission
  -> Determine Assignment
  -> Review Application User Task
```

Worker `Determine Assignment` melakukan:

1. membaca application;
2. membaca organization/team structure;
3. menentukan role;
4. menentukan candidate pool;
5. menentukan due date;
6. menentukan priority;
7. menyimpan assignment decision ke domain audit;
8. mengisi process variable minimal untuk user task.

Contoh output variable:

```json
{
  "reviewTask": {
    "candidateGroups": ["licensing-officer-region-east"],
    "assignee": null,
    "dueDate": "2026-06-24T17:00:00+08:00",
    "priority": 80
  }
}
```

### 8.2 Kenapa Assignment Jangan Hardcoded di Diagram

Buruk:

```text
User task candidate group = senior-officer-team-a
```

Jika organisasi berubah, BPMN harus redeploy.

Lebih baik:

```text
candidateGroups = ${reviewAssignment.candidateGroups}
```

Assignment policy berubah di service/config/DMN, bukan diagram.

---

## 9. Claim, Assign, Reassign, Unassign

Human workflow perlu membedakan aksi ini.

### 9.1 Claim

Claim berarti user mengambil task dari queue.

```text
Task available to group
User A claims task
Task assigned to User A
```

Claim cocok untuk pooled queue.

Constraint yang perlu dicek:

- user masih eligible;
- task belum assigned;
- task belum completed/cancelled;
- user tidak konflik dengan case;
- user punya capacity;
- task tidak locked oleh policy tertentu.

### 9.2 Assign

Assign bisa dilakukan oleh system/supervisor/admin.

```text
Supervisor assigns task to officerB
```

Assign perlu audit:

```text
assignedBy
assignedTo
assignedAt
reasonCode
comment
previousAssignee
```

### 9.3 Reassign

Reassign adalah mengganti assignee.

Alasan:

- user cuti;
- conflict of interest;
- workload imbalance;
- escalation;
- wrong assignment;
- supervisor intervention.

Reassign bukan hanya update metadata. Dalam sistem serius, reassign adalah **business event**.

Minimal audit:

```json
{
  "eventType": "TASK_REASSIGNED",
  "taskType": "REVIEW_APPLICATION",
  "caseId": "APP-2026-000123",
  "fromAssignee": "officerA",
  "toAssignee": "officerB",
  "performedBy": "supervisorA",
  "reasonCode": "OFFICER_ON_LEAVE",
  "comment": "Officer unavailable until next week.",
  "occurredAt": "2026-06-17T10:00:00+08:00"
}
```

### 9.4 Unassign

Unassign mengembalikan task ke pool.

Cocok untuk:

- wrong claim;
- user cannot proceed;
- task harus kembali ke queue setelah follow-up date;
- reassignment belum ditentukan.

Risiko:

- task hilang dari ownership;
- no one feels responsible;
- SLA tetap berjalan;
- high-priority task idle.

---

## 10. Task Visibility vs Task Permission vs Domain Authorization

Ini bagian yang sering disalahpahami.

### 10.1 Task Visibility

Siapa yang dapat melihat task di queue?

Contoh:

```text
Candidate group: licensing-officer
```

### 10.2 Task Permission

Siapa yang boleh melakukan aksi terhadap task?

Aksi:

- view;
- claim;
- unclaim;
- assign;
- reassign;
- complete;
- cancel;
- update due date;
- add comment;
- upload document;
- approve/reject.

### 10.3 Domain Authorization

Siapa yang boleh mengakses case/application/document di domain system?

Contoh:

```text
User is licensing officer
BUT application belongs to restricted enforcement case
AND user is not assigned to that enforcement case
=> user cannot view details
```

### 10.4 Kenapa Ketiganya Tidak Boleh Dicampur

Buruk:

```text
Kalau user bisa lihat task di Tasklist, berarti boleh lihat semua case data.
```

Ini berbahaya.

Lebih aman:

```text
Task visibility determines work queue.
Domain authorization determines data access.
Task permission determines allowed task action.
```

Arsitektur:

```text
Task UI
  -> query tasks from Camunda/task backend
  -> for each task, call domain authorization filter
  -> display only permitted data/actions
  -> complete task only after domain command succeeds
```

---

## 11. User Task Form Strategy

Form adalah interface untuk manusia menyelesaikan task.

Ada beberapa strategi:

1. Camunda generated/form model;
2. embedded/custom form;
3. external task application;
4. domain UI page linked from task;
5. hybrid: Tasklist for queue, custom app for details.

---

## 12. Form sebagai Input Contract, Bukan Domain Model

Kesalahan umum:

```text
Form field langsung sama dengan process variable langsung sama dengan domain table.
```

Ini terlihat cepat, tapi berbahaya.

Lebih sehat:

```text
Form input
  -> validate
  -> command DTO
  -> domain service
  -> domain persistence/audit
  -> process variables minimal
  -> complete user task
```

Contoh:

```text
Officer submits review form:
  decision = APPROVE
  comment = "Requirements met"
  selectedConditions = ["COND_A", "COND_B"]
```

Jangan langsung:

```text
completeTask({ decision, comment, selectedConditions })
```

dan berharap process variable menjadi source of truth.

Lebih baik:

```text
POST /applications/{id}/review-decision
  -> validate officer authorization
  -> validate current domain status
  -> persist ReviewDecision
  -> append audit event
  -> update Application.status
  -> complete Camunda task with minimal variables
```

Process variable minimal:

```json
{
  "reviewOutcome": "APPROVE",
  "reviewDecisionId": "REV-2026-000888"
}
```

---

## 13. Form Types

### 13.1 Simple Completion Form

Cocok untuk task sederhana:

- approve/reject;
- select reason;
- add comment;
- confirm action.

Contoh:

```text
Task: Supervisor Approval
Fields:
  - decision: APPROVE | RETURN | REJECT
  - reasonCode
  - comment
```

### 13.2 Data Entry Form

Cocok untuk:

- applicant clarification;
- officer entering assessment details;
- admin correction.

Risiko:

- banyak field;
- validation kompleks;
- draft diperlukan;
- partial save diperlukan;
- upload dokumen;
- field-level permission.

Jika form kompleks, jangan terlalu mengandalkan form engine sederhana. Gunakan custom domain UI.

### 13.3 Review Form

Cocok untuk:

- read mostly;
- approve/reject;
- see evidence;
- compare old/new values;
- view audit history.

Dalam review form, data utama biasanya dari domain backend, bukan process variable.

### 13.4 Dynamic Form

Form berubah berdasarkan:

- application type;
- officer role;
- risk score;
- previous answers;
- policy version;
- agency;
- jurisdiction.

Dynamic form membutuhkan governance:

```text
form version
schema version
validation version
policy version
rendering compatibility
submission compatibility
```

### 13.5 External UI Form

Pattern paling umum di enterprise:

```text
Tasklist shows queue
User clicks task
Task opens custom application page
Custom app handles domain form
Custom app completes task through backend
```

Kelebihan:

- full control UI/UX;
- domain authorization kuat;
- complex validation;
- reuse existing application;
- better audit integration;
- easier file upload/document handling.

Kekurangan:

- perlu integrasi Task API;
- perlu handle task stale/completed;
- perlu sync task metadata;
- perlu custom security.

---

## 14. Draft vs Complete

Human work sering tidak selesai dalam satu submit.

Contoh officer review:

1. buka task;
2. baca dokumen;
3. isi partial checklist;
4. simpan draft;
5. minta input internal;
6. kembali besok;
7. submit decision;
8. complete task.

Jangan membuat process lanjut saat user baru save draft.

Bedakan:

```text
Save draft = domain/application state update only
Complete task = final action that advances BPMN process
```

Contoh API:

```http
PUT /applications/{applicationId}/review-draft
POST /applications/{applicationId}/review-submit
```

`review-submit` melakukan complete Camunda task.

### 14.1 Draft Storage

Draft sebaiknya disimpan di domain DB, bukan process variable besar.

```text
review_draft
  id
  application_id
  task_id
  draft_json
  updated_by
  updated_at
  version
```

Ketika final submit:

```text
review_decision
  id
  application_id
  decision
  reason_code
  comment
  submitted_by
  submitted_at
  source_task_id
```

Process variable cukup:

```json
{
  "reviewDecisionId": "RD-123",
  "reviewOutcome": "APPROVE"
}
```

---

## 15. SLA, Due Date, Follow-up Date, Timer, Reminder, Escalation

Human workflow tanpa SLA akan menjadi invisible backlog.

Ada beberapa konsep waktu:

1. created time;
2. follow-up date;
3. due date;
4. reminder time;
5. escalation time;
6. expiry time;
7. business calendar deadline;
8. legal deadline.

---

## 16. Follow-up Date vs Due Date

Secara konseptual:

```text
follow-up date = kapan task seharusnya mulai diperhatikan/dikerjakan

due date = kapan task harus selesai
```

Contoh:

```text
Task created: 2026-06-17 09:00
Follow-up:    2026-06-18 09:00
Due date:     2026-06-24 17:00
```

Artinya:

- task boleh ada hari ini;
- user tidak harus mulai sekarang;
- paling lambat mulai besok;
- harus selesai sebelum 24 Juni 17:00.

### 16.1 Kapan Follow-up Date Berguna?

- task belum perlu muncul di urgent queue;
- reminder untuk mulai bekerja;
- applicant diberi waktu melengkapi dokumen;
- supervisor review dijadwalkan setelah officer submit;
- scheduled inspection.

### 16.2 Kapan Due Date Berguna?

- SLA completion;
- legal deadline;
- escalation trigger;
- priority ordering;
- overdue reporting;
- supervisor dashboard.

---

## 17. BPMN Timer vs Task Due Date

Task due date tidak otomatis berarti process berubah jalur. Due date biasanya metadata untuk task ordering/SLA.

Jika process harus melakukan aksi saat deadline lewat, gunakan timer.

Contoh:

```text
[Applicant Clarification User Task]
  boundary timer PT14D
    -> Auto Close / Escalate / Send Reminder
```

Perbedaan:

```text
Due date:
  task metadata
  helps queue/order/report
  does not necessarily move token

Boundary timer:
  BPMN control flow
  can interrupt or non-interrupt
  changes process path
```

Jangan mengandalkan due date untuk business transition yang harus deterministik. Pakai BPMN timer atau scheduled service yang jelas.

---

## 18. Reminder Pattern

Reminder biasanya non-interrupting.

```text
[Officer Review User Task]
  non-interrupting timer after 2 days
    -> Send Reminder Email
  non-interrupting timer after 4 days
    -> Notify Supervisor
  interrupting timer after 5 days
    -> Escalate Task
```

Namun timer terlalu banyak bisa membuat model bising. Alternatif:

```text
SLA monitoring service scans task/domain deadlines
  -> sends reminder
  -> records reminder event
  -> optionally publishes message to process
```

Pilih berdasarkan kebutuhan:

```text
Jika reminder adalah bagian legal/process contract -> model di BPMN.
Jika reminder hanya operational notification -> external SLA service boleh cukup.
```

---

## 19. Escalation Pattern

Escalation bukan selalu error. Escalation berarti perhatian naik ke level lebih tinggi.

Contoh:

```text
Officer Review not completed within 5 working days
  -> supervisor notified
  -> task remains with officer
```

Ini non-interrupting escalation.

Contoh lain:

```text
Officer Review not completed within 10 working days
  -> task reassigned to supervisor pool
```

Ini bisa interrupting path.

### 19.1 Escalation Types

```text
Notification escalation:
  send email/dashboard alert only

Visibility escalation:
  supervisor can see task

Ownership escalation:
  task reassigned

Authority escalation:
  supervisor can complete/override

Process escalation:
  BPMN moves to escalation subprocess
```

Jangan menyamakan semua escalation.

---

## 20. Business Calendar Problem

SLA sering bukan calendar duration sederhana.

Contoh:

```text
Officer review SLA = 5 working days excluding weekends and public holidays.
Applicant clarification deadline = 14 calendar days.
Appeal submission deadline = 30 calendar days from decision notification.
Payment deadline = 7 calendar days.
```

BPMN timer `P5D` berarti durasi lima hari, bukan “lima working days dengan holiday calendar”.

Karena itu sistem production biasanya butuh `DeadlineService`:

```java
public interface DeadlineService {
    OffsetDateTime addWorkingDays(
        OffsetDateTime start,
        int workingDays,
        String calendarCode,
        ZoneId zoneId
    );

    OffsetDateTime addCalendarDays(
        OffsetDateTime start,
        int calendarDays,
        ZoneId zoneId
    );
}
```

Deadline hasil perhitungan disimpan sebagai domain fact:

```text
application_review_deadline
  application_id
  deadline_type
  deadline_at
  calendar_code
  calculated_by_policy_version
  calculated_at
```

Lalu dipakai untuk due date/timer.

---

## 21. Priority

Priority membantu ordering task.

Namun priority bukan pengganti SLA.

Contoh priority dimension:

```text
legal deadline near
case sensitivity high
VIP/critical agency
risk score high
appeal case
manual escalation
oldest first
```

Priority bisa dihitung:

```text
priority = basePriority(applicationType)
         + riskScoreWeight
         + deadlineUrgencyWeight
         + escalationWeight
```

Tapi hati-hati: jika priority terlalu dinamis, task queue menjadi sulit dijelaskan. Untuk regulatory system, priority harus defensible.

Audit question:

```text
Mengapa case A dikerjakan sebelum case B?
```

Jika tidak bisa dijawab, priority model bermasalah.

---

## 22. Maker-Checker / Four-Eyes Principle

Maker-checker berarti orang yang membuat/rekomendasikan tidak boleh menjadi orang yang menyetujui.

Contoh:

```text
Officer prepares recommendation
Supervisor approves recommendation
Officer != Supervisor
```

BPMN sederhana:

```text
[Review Application]
  -> [Supervisor Approval]
  -> gateway approve/reject/return
```

Namun constraint tidak cukup hanya dari BPMN. Harus ada authorization/domain validation.

### 22.1 Data yang Perlu Dicatat

```text
maker_user_id
maker_role
maker_action
maker_at
checker_user_id
checker_role
checker_action
checker_at
checker_decision
checker_reason_code
```

### 22.2 Constraint

```text
checker != maker
checker has required role
checker belongs to authorized unit
checker has no conflict-of-interest
checker can approve this amount/risk/category
```

### 22.3 Pattern Java Validation

```java
public final class ApprovalPolicy {

    public void validateSupervisorApproval(
            Application application,
            ReviewDecision reviewDecision,
            UserContext checker) {

        if (reviewDecision.reviewedBy().equals(checker.userId())) {
            throw new BusinessRuleViolation(
                "MAKER_CHECKER_VIOLATION",
                "The reviewer cannot approve their own recommendation."
            );
        }

        if (!checker.hasRole("LICENSING_SUPERVISOR")) {
            throw new BusinessRuleViolation(
                "INSUFFICIENT_ROLE",
                "Only licensing supervisors can approve this recommendation."
            );
        }

        if (!checker.canAccessRegion(application.region())) {
            throw new BusinessRuleViolation(
                "REGION_NOT_AUTHORIZED",
                "Supervisor is not authorized for this region."
            );
        }
    }
}
```

Process variable after approval:

```json
{
  "supervisorOutcome": "APPROVE",
  "approvalDecisionId": "APR-2026-000123"
}
```

---

## 23. Return / Rework Pattern

Human workflow sering punya return path.

Contoh:

```text
Officer Review -> Supervisor Approval
Supervisor returns to Officer for rework
Officer revises recommendation
Supervisor approves
```

BPMN:

```text
[Officer Review]
  -> [Supervisor Approval]
      -> APPROVE -> continue
      -> RETURN_FOR_REWORK -> [Officer Rework]
      -> REJECT -> rejection flow
```

Pertanyaan desain:

```text
Apakah rework task sama dengan review task?
Apakah assignee harus officer sebelumnya?
Apakah SLA reset atau continue?
Apakah version rekomendasi dibuat baru?
Apakah supervisor comment mandatory?
Berapa kali return diperbolehkan?
```

### 23.1 Rework Counter

Process variable bisa menyimpan counter ringan:

```json
{
  "reworkCount": 2
}
```

Tapi detail rework harus di domain audit:

```text
review_cycle
  cycle_no
  submitted_by
  submitted_at
  returned_by
  returned_at
  return_reason
  comment
```

---

## 24. Clarification Pattern

Regulatory workflow sering perlu minta klarifikasi dari applicant.

```text
Officer Review
  -> Need Clarification?
    -> Request Clarification
    -> Applicant Submit Clarification
    -> Officer Review Clarification
```

Desain penting:

1. Apa status domain selama clarification?
2. Apakah officer SLA pause?
3. Apakah applicant punya deadline?
4. Apa yang terjadi jika applicant tidak menjawab?
5. Apakah clarification bisa berulang?
6. Apakah semua clarification request wajib punya reason code?
7. Apakah dokumen tambahan wajib?
8. Apakah process harus notify applicant?

### 24.1 Clarification dengan Boundary Timer

```text
[Applicant Submit Clarification]
  boundary timer 14 days interrupting
    -> Auto Close / Withdraw / Reject / Escalate
```

### 24.2 Clarification as Subprocess

Jika clarification kompleks:

```text
Call Activity: Applicant Clarification Process
```

Dengan output:

```json
{
  "clarificationOutcome": "SUBMITTED" | "EXPIRED" | "WITHDRAWN"
}
```

---

## 25. Task UI Architecture

Ada beberapa pilihan arsitektur.

### 25.1 Use Camunda Tasklist Directly

```text
User -> Camunda Tasklist -> Camunda APIs
```

Cocok untuk:

- internal workflow sederhana;
- fast delivery;
- form relatif sederhana;
- authorization cukup sesuai platform;
- tidak perlu custom domain UI kompleks.

Risiko:

- domain authorization terbatas;
- UI customization terbatas;
- complex form sulit;
- enterprise UX tidak seragam;
- integration dengan domain app perlu dipikirkan.

### 25.2 Custom Task Application

```text
User -> Custom UI -> Java Backend -> Camunda API + Domain Services
```

Cocok untuk:

- enterprise case management;
- complex authorization;
- complex form;
- domain-heavy UI;
- file/document management;
- fine-grained audit;
- integrated dashboard.

### 25.3 Hybrid

```text
Camunda Tasklist for generic queue
Custom domain app for task detail and completion
```

Atau:

```text
Custom dashboard pulls Camunda tasks and domain data
```

Untuk regulatory platform, hybrid/custom sering lebih realistis.

---

## 26. Backend Completion Pattern

Jangan biarkan frontend langsung complete task jika task completion harus memodifikasi domain data.

Buruk:

```text
Browser -> Camunda complete task
Browser -> Domain API update status
```

Masalah:

- urutan bisa gagal;
- user bisa manipulate variables;
- authorization lemah;
- audit terpecah;
- process lanjut walau domain update gagal.

Lebih baik:

```text
Browser -> Java Backend submit decision
Java Backend:
  1. authenticate user
  2. load task
  3. load domain entity
  4. validate task is active
  5. validate user can act
  6. validate domain state
  7. persist decision/audit/domain status in DB transaction
  8. complete Camunda task with minimal variables
  9. return result
```

### 26.1 Consistency Challenge

DB transaction dan Camunda task completion tidak berada dalam satu local ACID transaction.

Failure window:

```text
Domain DB commit succeeds
Camunda complete task fails
```

Solusi:

- use outbox command to complete task;
- make complete task idempotent;
- record workflow command status;
- retry completion;
- reconcile stuck domain/workflow mismatch.

Pattern:

```text
HTTP submit decision
  -> DB transaction:
       save decision
       update domain status
       insert workflow_outbox COMPLETE_TASK command
  -> async dispatcher completes Camunda task
  -> mark outbox dispatched
```

Atau synchronous with recovery:

```text
DB commit
try complete task
if fail: task_completion_pending = true
reconciler retries
```

Untuk high-assurance regulatory system, outbox lebih kuat.

---

## 27. Example Java Backend Flow

### 27.1 Command DTO

```java
public final class SubmitReviewDecisionCommand {
    private final String applicationId;
    private final String taskId;
    private final String decision;
    private final String reasonCode;
    private final String comment;

    public SubmitReviewDecisionCommand(
            String applicationId,
            String taskId,
            String decision,
            String reasonCode,
            String comment) {
        this.applicationId = applicationId;
        this.taskId = taskId;
        this.decision = decision;
        this.reasonCode = reasonCode;
        this.comment = comment;
    }

    public String applicationId() { return applicationId; }
    public String taskId() { return taskId; }
    public String decision() { return decision; }
    public String reasonCode() { return reasonCode; }
    public String comment() { return comment; }
}
```

Java 16+ bisa memakai record:

```java
public record SubmitReviewDecisionCommand(
    String applicationId,
    String taskId,
    ReviewDecision decision,
    String reasonCode,
    String comment
) {}
```

### 27.2 Application Service

```java
public final class ReviewApplicationService {

    private final ApplicationRepository applicationRepository;
    private final ReviewDecisionRepository reviewDecisionRepository;
    private final TaskAuthorizationService taskAuthorizationService;
    private final WorkflowOutboxRepository workflowOutboxRepository;
    private final AuditLogRepository auditLogRepository;

    public ReviewApplicationService(
            ApplicationRepository applicationRepository,
            ReviewDecisionRepository reviewDecisionRepository,
            TaskAuthorizationService taskAuthorizationService,
            WorkflowOutboxRepository workflowOutboxRepository,
            AuditLogRepository auditLogRepository) {
        this.applicationRepository = applicationRepository;
        this.reviewDecisionRepository = reviewDecisionRepository;
        this.taskAuthorizationService = taskAuthorizationService;
        this.workflowOutboxRepository = workflowOutboxRepository;
        this.auditLogRepository = auditLogRepository;
    }

    public ReviewDecisionResult submit(
            SubmitReviewDecisionCommand command,
            UserContext user) {

        Application application = applicationRepository.getForUpdate(command.applicationId());

        taskAuthorizationService.assertCanCompleteReviewTask(
            user,
            command.taskId(),
            application
        );

        application.assertStatus(ApplicationStatus.UNDER_REVIEW);

        ReviewDecision decision = ReviewDecision.create(
            application.id(),
            command.taskId(),
            command.decision(),
            command.reasonCode(),
            command.comment(),
            user.userId()
        );

        reviewDecisionRepository.save(decision);

        if (decision.isApproved()) {
            application.markReviewApproved(decision.id());
        } else if (decision.isClarificationRequired()) {
            application.markPendingClarification(decision.id());
        } else if (decision.isRejected()) {
            application.markReviewRejected(decision.id());
        }

        applicationRepository.save(application);

        auditLogRepository.append(AuditEvent.reviewSubmitted(
            application.id(),
            decision.id(),
            user.userId(),
            decision.outcome(),
            decision.reasonCode()
        ));

        workflowOutboxRepository.insertCompleteTaskCommand(
            WorkflowCompleteTaskCommand.builder()
                .taskId(command.taskId())
                .businessKey(application.id())
                .idempotencyKey("complete-review-task:" + command.taskId())
                .variable("reviewOutcome", decision.outcome().name())
                .variable("reviewDecisionId", decision.id())
                .build()
        );

        return new ReviewDecisionResult(application.id(), decision.id(), decision.outcome());
    }
}
```

### 27.3 Outbox Dispatcher

```java
public final class WorkflowOutboxDispatcher {

    private final WorkflowOutboxRepository repository;
    private final CamundaTaskClient taskClient;

    public void dispatchBatch() {
        List<WorkflowOutboxCommand> commands = repository.findPending(100);

        for (WorkflowOutboxCommand command : commands) {
            try {
                if (command.type() == WorkflowCommandType.COMPLETE_TASK) {
                    taskClient.completeTask(command.taskId(), command.variables());
                }

                repository.markDispatched(command.id());
            } catch (TaskAlreadyCompletedException e) {
                repository.markDispatched(command.id());
            } catch (TaskNotFoundException e) {
                repository.markNeedsInvestigation(command.id(), e.getMessage());
            } catch (TransientWorkflowException e) {
                repository.markRetry(command.id(), e.getMessage());
            }
        }
    }
}
```

Catatan: nama client/API akan bergantung pada versi dan strategi integrasi yang dipakai. Inti pattern-nya adalah **domain commit dulu dengan command outbox, task completion idempotent setelahnya**.

---

## 28. Task Completion Variables

Ketika complete user task, jangan kirim payload besar.

Buruk:

```json
{
  "application": {
    "id": "APP-1",
    "applicant": { "name": "...", "address": "...", "identityNo": "..." },
    "documents": [ ... huge ... ],
    "reviewChecklist": [ ... huge ... ]
  }
}
```

Lebih baik:

```json
{
  "reviewOutcome": "APPROVE",
  "reviewDecisionId": "REV-2026-00123"
}
```

Process butuh outcome untuk routing, bukan seluruh data domain.

---

## 29. Authorization Pattern untuk Complete Task

Minimal validation sebelum complete:

```text
1. User authenticated.
2. Task exists and active.
3. Task belongs to expected process/business entity.
4. User can view the task.
5. User can access the domain entity.
6. User can perform requested action.
7. User is current assignee or allowed to complete as candidate/supervisor.
8. Domain entity is in expected status.
9. Maker-checker/conflict constraints pass.
10. Required form fields valid.
```

### 29.1 Jangan Percaya `taskId` dari Browser Saja

User bisa mengirim taskId milik case lain.

Backend harus verify:

```text
task.processInstanceKey == application.workflowInstanceKey
task.elementId == expectedTaskElementId
task.state == ACTIVE
task.assignee == user OR user can claim/complete
```

### 29.2 Action-based Authorization

Jangan hanya role-based.

Contoh:

```text
Role: LICENSING_SUPERVISOR
Action: APPROVE_RECOMMENDATION
Resource: Application APP-2026-00123
Context:
  region = EAST
  riskLevel = HIGH
  maker = officerA
  checker = supervisorB
```

Authorization decision:

```text
ALLOW if:
  user has role LICENSING_SUPERVISOR
  and user.region includes EAST
  and user.approvalLimit >= application.riskLevel
  and user.id != maker
```

---

## 30. Comments, Attachments, and Evidence

Human tasks often produce supporting evidence:

- comments;
- checklist answers;
- file attachments;
- screenshots;
- letters;
- uploaded documents;
- approval memo;
- legal advice;
- internal notes.

Do not store large evidence in process variables.

Pattern:

```text
Document service stores file/evidence.
Domain DB stores metadata/reference.
Process variable stores reference id only if needed for routing.
```

Example:

```json
{
  "legalOpinionDocumentId": "DOC-2026-009991"
}
```

Audit trail:

```text
who uploaded
when uploaded
file hash
document type
case id
source task
visibility level
retention policy
```

---

## 31. Regulatory Defensibility

Dalam regulatory/case-management system, setiap human action harus bisa dijelaskan nanti.

Pertanyaan audit:

```text
Siapa yang menerima task?
Kapan task dibuat?
Siapa yang melihat task?
Siapa yang claim?
Siapa yang complete?
Apa decision-nya?
Apa reason code-nya?
Apa evidence-nya?
Apa policy version yang berlaku?
Apakah SLA breached?
Jika reassigned, kenapa?
Jika supervisor override, kenapa?
Jika applicant tidak menjawab, apakah reminder dikirim?
Jika task selesai terlambat, siapa yang approve exception?
```

### 31.1 Event yang Perlu Dicatat

Minimal:

```text
TASK_CREATED
TASK_ASSIGNED
TASK_CLAIMED
TASK_UNASSIGNED
TASK_REASSIGNED
TASK_VIEWED            optional, sensitive/high-assurance systems
TASK_DRAFT_SAVED
TASK_COMMENT_ADDED
TASK_DOCUMENT_UPLOADED
TASK_COMPLETED
TASK_CANCELLED
TASK_ESCALATED
TASK_DUE_DATE_CHANGED
TASK_PRIORITY_CHANGED
```

Tidak semua harus disimpan di Camunda. Domain audit/event store sering lebih cocok.

### 31.2 Reason Code Discipline

Free-text comment saja tidak cukup.

Gunakan reason code:

```text
APPROVE_ALL_REQUIREMENTS_MET
REJECT_MISSING_MANDATORY_DOCUMENT
RETURN_INSUFFICIENT_ASSESSMENT
REASSIGN_OFFICER_ON_LEAVE
ESCALATE_SLA_BREACH
OVERRIDE_URGENT_PUBLIC_INTEREST
```

Free-text comment melengkapi reason code, bukan menggantikannya.

---

## 32. Task Search and Dashboard Design

Task list bukan sekadar list row.

Queue yang baik membantu operator mengambil keputusan.

Kolom umum:

```text
Task name
Case/Application number
Applicant/Entity name
Status
Priority
Due date
Age
SLA remaining
Assignee
Candidate group
Risk level
Region/team
Created at
Last updated
Escalation flag
```

Filter umum:

```text
My tasks
Unassigned tasks
Team tasks
Overdue tasks
Due today
High priority
Escalated
By process type
By application type
By region
By applicant/entity
By officer
```

Sorting umum:

```text
Due date ascending
Priority descending
Created date ascending
SLA remaining ascending
Risk level descending
```

### 32.1 Dashboard untuk Supervisor

Supervisor butuh view berbeda:

```text
Team workload
Aging tasks
Overdue tasks
Tasks by assignee
Tasks by stage
Escalation queue
Reassignment candidates
SLA breach trend
Bottleneck process step
```

### 32.2 Dashboard untuk Process Owner

Process owner butuh process-level analytics:

```text
Average cycle time
Median/percentile task duration
Task wait time
Rework rate
Clarification rate
Approval/rejection distribution
SLA compliance
Bottleneck stage
Policy impact
```

---

## 33. Human Workflow Race Conditions

Human tasks punya race condition yang sering diabaikan.

### 33.1 Two Users Claim Same Task

```text
Officer A and Officer B click claim at same time.
```

Harus atomic di task system. Jika custom backend, gunakan optimistic locking/task API semantics.

### 33.2 User Opens Task, Task Completed by Someone Else

```text
Officer A opens task.
Supervisor reassigns/completes/cancels task.
Officer A submits stale form.
```

Backend harus check task active/current sebelum submit.

Response:

```text
Task is no longer available. Please refresh.
```

### 33.3 Boundary Timer Fires While User Submits

```text
Applicant submits clarification exactly when deadline timer fires.
```

Butuh deterministic policy:

```text
If submission received before deadline timestamp, accept.
If after deadline, reject or require supervisor override.
```

Jangan bergantung pada race engine semata. Domain deadline validation harus eksplisit.

### 33.4 User Has Permission at Open, Loses Permission Before Submit

```text
User role changed while form open.
```

Backend harus validate permission saat submit, bukan hanya saat open.

---

## 34. Task Cancellation Semantics

Jika user task dibatalkan oleh boundary event atau process path, apa yang terjadi?

Contoh:

```text
Officer reviewing application
Applicant withdraws application
Review task cancelled
Process moves to withdrawn end state
```

Desain yang perlu:

- task hilang dari queue;
- draft officer tetap disimpan atau dibuang?;
- officer diberi notification?;
- domain status menjadi WITHDRAWN;
- audit mencatat cancellation reason;
- pending reminders dihentikan;
- documents locked/unlocked.

Task cancellation adalah business-visible event, bukan sekadar engine cleanup.

---

## 35. Delegation and Substitute User

Enterprise workflow sering perlu delegation:

```text
Officer A cuti 1 minggu.
Task diarahkan ke Officer B.
```

Model:

1. temporary delegation;
2. permanent reassignment;
3. supervisor takeover;
4. team pool fallback;
5. automatic out-of-office routing.

Data penting:

```text
delegator
delegatee
valid_from
valid_to
scope/task_type
reason
approved_by
```

Jangan hanya mengubah assignee tanpa audit.

---

## 36. Separation of Duties

Selain maker-checker, ada separation-of-duties yang lebih luas.

Contoh:

```text
User who performed investigation cannot approve closure.
User who requested enforcement action cannot approve appeal outcome.
User who created applicant profile cannot approve licence issuance.
```

Ini biasanya tidak bisa dimodelkan hanya dengan candidate group. Harus domain policy.

Pattern:

```text
DecisionHistoryService.findActors(applicationId)
ApprovalPolicy.assertNoForbiddenActorOverlap(user, previousActors, action)
```

---

## 37. Multi-user Approval Patterns

### 37.1 Sequential Approval

```text
Officer Review -> Supervisor Approval -> Director Approval
```

Cocok untuk hierarchy jelas.

### 37.2 Parallel Approval

```text
Legal Review + Finance Review + Compliance Review
  -> join
```

Cocok untuk independent review.

### 37.3 N-of-M Approval

```text
Need 2 of 3 committee members approve.
```

Bisa memakai multi-instance user task dengan completion condition, tetapi audit dan assignment perlu hati-hati.

### 37.4 Consensus / Committee

Jika diskusi dan voting kompleks, mungkin lebih baik model domain committee module, bukan memaksakan BPMN gateway terlalu rumit.

---

## 38. User Task and DMN

DMN bisa membantu menentukan:

- candidate group;
- required approval level;
- SLA;
- priority;
- required checklist;
- next route after decision.

Contoh decision table:

```text
Input:
  applicationType
  riskScore
  amount
  previousViolation

Output:
  reviewGroup
  approvalLevel
  slaWorkingDays
  priority
```

BPMN:

```text
[Determine Review Policy - DMN]
  -> [Officer Review]
  -> [Supervisor/Director Approval depending on approvalLevel]
```

Keuntungan:

- policy lebih mudah berubah;
- business rule explicit;
- audit decision bisa dicatat;
- BPMN tidak penuh nested gateway.

---

## 39. Camunda 7 vs Camunda 8 Human Task Difference

Secara konseptual sama-sama punya user task, tetapi programming dan runtime integration berbeda.

### 39.1 Camunda 7

Umumnya:

- task ada di engine database;
- Java app bisa memakai TaskService;
- embedded engine memungkinkan transaction coupling lebih dekat;
- forms bisa memakai Camunda 7 form mechanisms;
- Cockpit/Tasklist/Admin klasik.

Pattern Java:

```java
taskService.claim(taskId, userId);
taskService.complete(taskId, variables);
```

Karena engine sering embedded dalam Spring app, banyak sistem menggabungkan domain transaction dan engine interaction lebih dekat. Ini nyaman, tapi bisa membuat coupling tinggi.

### 39.2 Camunda 8

Umumnya:

- task adalah bagian orchestration cluster/runtime;
- Tasklist/API digunakan untuk human tasks;
- domain app berkomunikasi remote;
- consistency dengan domain DB perlu pattern outbox/retry;
- authorization perlu diselaraskan antara Camunda Identity/platform dan domain system.

Camunda 8 lebih memaksa pemisahan:

```text
workflow runtime != domain application transaction
```

Ini lebih cloud-native, tetapi butuh engineering discipline lebih tinggi.

---

## 40. Java 8 sampai Java 25 Considerations

### 40.1 Java 8

Gunakan:

- immutable DTO manual;
- `Optional` secukupnya;
- explicit validation;
- no records;
- no sealed classes;
- CompletableFuture hati-hati.

Cocok untuk legacy Camunda 7 app.

### 40.2 Java 11 / 17

Java 17 adalah baseline modern yang kuat untuk Spring Boot 3 ecosystem.

Gunakan:

- records jika di Java 16+;
- switch expression;
- better HTTP client;
- improved GC;
- stronger typing for command/result.

### 40.3 Java 21 / 25

Untuk task backend/worker modern:

- virtual threads bisa berguna untuk IO-heavy task integration;
- structured concurrency dapat membantu orchestration di worker/application service;
- pattern matching/sealed types membantu modeling decision/action;
- tetap jangan pakai virtual thread sebagai alasan mengabaikan rate limit/backpressure.

Contoh sealed action model:

```java
public sealed interface ReviewAction permits Approve, Reject, RequestClarification {}

public record Approve(String reasonCode, String comment) implements ReviewAction {}
public record Reject(String reasonCode, String comment) implements ReviewAction {}
public record RequestClarification(String reasonCode, String comment) implements ReviewAction {}
```

Ini membuat action lebih explicit daripada string bebas.

---

## 41. API Design untuk Custom Task Application

Contoh endpoint:

```http
GET  /work/tasks?view=my
GET  /work/tasks?view=team&group=licensing-officer
GET  /work/tasks/{taskId}
POST /work/tasks/{taskId}/claim
POST /work/tasks/{taskId}/unclaim
POST /work/tasks/{taskId}/assign
POST /work/tasks/{taskId}/complete
POST /work/tasks/{taskId}/comments
POST /work/tasks/{taskId}/attachments
```

Namun untuk domain action, lebih baik action-oriented:

```http
POST /applications/{applicationId}/review/submit
POST /applications/{applicationId}/review/request-clarification
POST /applications/{applicationId}/approval/approve
POST /applications/{applicationId}/approval/reject
POST /applications/{applicationId}/approval/return
```

Kenapa?

Karena user tidak “complete task” secara business. User “approve recommendation”, “request clarification”, “reject application”.

Task completion adalah technical consequence.

---

## 42. Domain Command over Generic Task Complete

Buruk:

```http
POST /tasks/{taskId}/complete
{
  "variables": {
    "decision": "APPROVE"
  }
}
```

Ini terlalu generic.

Lebih baik:

```http
POST /applications/APP-2026-000123/review-decision
{
  "taskId": "2251799813689999",
  "decision": "APPROVE",
  "reasonCode": "ALL_REQUIREMENTS_MET",
  "comment": "Checklist completed."
}
```

Backend tahu ini adalah domain command, bukan hanya workflow operation.

---

## 43. Field-level Permission

Dalam regulatory case, user bisa punya akses task tapi tidak semua field.

Contoh:

```text
Officer can view applicant profile but not enforcement intelligence note.
Supervisor can view all review notes.
Legal can view legal memo but not financial internal note.
Applicant can view public clarification request but not internal comments.
```

Form rendering harus berdasarkan permission.

Pattern:

```text
GET task detail
  -> backend returns allowed fields/actions only
```

Jangan kirim semua data ke browser lalu sembunyikan di frontend.

---

## 44. Task Action Model

Task detail harus menampilkan allowed actions.

Contoh response:

```json
{
  "taskId": "T-123",
  "taskName": "Review Application",
  "applicationId": "APP-2026-000123",
  "assignee": "officerA",
  "allowedActions": [
    "SAVE_DRAFT",
    "SUBMIT_REVIEW",
    "REQUEST_CLARIFICATION",
    "UNCLAIM"
  ],
  "fields": {
    "decision": { "visible": true, "editable": true },
    "internalRiskNote": { "visible": true, "editable": false },
    "legalMemo": { "visible": false, "editable": false }
  }
}
```

Ini lebih aman daripada UI menebak action dari role lokal.

---

## 45. Stale Task Handling

Frontend harus siap menerima:

```text
TASK_NOT_FOUND
TASK_ALREADY_COMPLETED
TASK_CANCELLED
TASK_ASSIGNED_TO_OTHER_USER
TASK_NOT_AUTHORIZED
DOMAIN_STATUS_CHANGED
SLA_EXPIRED
```

User-friendly response:

```text
This task is no longer available. It may have been completed, reassigned, or cancelled. Please refresh your task list.
```

Audit tetap mencatat attempted invalid action jika relevan security.

---

## 46. Human Workflow Observability

Metrics penting:

```text
task_created_total
task_completed_total
task_cancelled_total
task_reassigned_total
task_escalated_total
task_overdue_total
task_completion_duration_seconds
task_wait_duration_seconds
task_claim_duration_seconds
task_rework_count
task_clarification_count
sla_breach_total
```

Dimensi:

```text
process_id
task_type
candidate_group
assignee/team
application_type
region
risk_level
priority
outcome
```

Dashboard yang bagus menjawab:

```text
Di step mana process bottleneck?
Team mana paling overload?
Task apa yang sering overdue?
Siapa yang punya backlog tinggi?
Apakah rework meningkat setelah policy change?
Apakah clarification rate abnormal?
```

---

## 47. Human Workflow Testing

Test yang perlu:

### 47.1 Assignment Test

```text
Given application type X and region Y
When determine assignment
Then candidate group is licensing-officer-region-y
And due date is 5 working days
```

### 47.2 Authorization Test

```text
Given user is not assignee
When user completes task
Then reject with TASK_NOT_AUTHORIZED
```

### 47.3 Maker-checker Test

```text
Given officerA reviewed application
When officerA tries supervisor approval
Then reject MAKER_CHECKER_VIOLATION
```

### 47.4 SLA Test

```text
Given task due date passed
When SLA monitor runs
Then escalation event is recorded
And supervisor is notified
```

### 47.5 Race Condition Test

```text
Given two users claim same task concurrently
Then exactly one succeeds
```

### 47.6 Stale Submit Test

```text
Given user opened task
And task later completed by another user
When first user submits
Then reject stale task
```

---

## 48. Anti-patterns

### 48.1 User Task as Screen

```text
Setiap screen dibuat user task.
```

Salah. User task adalah wait state untuk pekerjaan manusia, bukan routing page UI.

### 48.2 User Task as Status

```text
Kalau task ada berarti status X.
```

Salah. Domain status harus explicit.

### 48.3 Direct Frontend to Camunda Complete

```text
Browser completes task with variables directly.
```

Berbahaya untuk domain workflow serius.

### 48.4 No Reason Code

```text
Decision: REJECT
Comment: "not ok"
```

Tidak defensible.

### 48.5 Candidate Group as Full Authorization

```text
Jika candidate group cocok, user pasti boleh lihat dan complete.
```

Tidak cukup untuk enterprise/regulatory context.

### 48.6 No SLA Model

Task dibuat, tapi tidak ada due date, reminder, escalation, atau aging dashboard.

### 48.7 Reassignment Without Audit

Task dipindah tanpa reason.

### 48.8 Form Writes Huge Variables

Form submit menyimpan seluruh application snapshot ke process variable.

### 48.9 Task Completion Before Domain Commit

Process lanjut, tetapi domain decision gagal disimpan.

### 48.10 Hardcoded Assignment in BPMN

Organization berubah, process harus redeploy.

---

## 49. Production Design Checklist

Sebelum user task dianggap production-ready, jawab ini:

### 49.1 Purpose

```text
Apa pekerjaan manusia yang direpresentasikan task ini?
Apa outcome yang valid?
Apa business meaning dari completion?
```

### 49.2 Assignment

```text
Siapa candidate group/user?
Bagaimana assignee ditentukan?
Apakah assignment dynamic?
Apa fallback jika assignee unavailable?
```

### 49.3 Authorization

```text
Siapa boleh view?
Siapa boleh claim?
Siapa boleh complete?
Siapa boleh reassign?
Apakah domain authorization dicek?
Apakah maker-checker dicek?
```

### 49.4 Form

```text
Field apa yang required?
Apakah draft diperlukan?
Di mana data disimpan?
Apakah form versioned?
Apakah validation domain-side?
```

### 49.5 SLA

```text
Apa due date?
Apa follow-up date?
Apa reminder?
Apa escalation?
Apakah pakai working day/calendar day?
Apa yang terjadi setelah expiry?
```

### 49.6 Completion

```text
Apa variable minimal untuk process routing?
Apakah domain decision disimpan dulu?
Apakah complete task idempotent?
Apakah ada outbox/retry?
```

### 49.7 Audit

```text
Apakah created/claimed/assigned/completed/reassigned/escalated tercatat?
Apakah reason code mandatory?
Apakah comment/evidence linked?
Apakah audit bisa menjawab pertanyaan regulator?
```

### 49.8 Operations

```text
Bagaimana melihat stuck task?
Bagaimana reassign task?
Bagaimana repair failed completion?
Bagaimana handle overdue?
Bagaimana dashboard supervisor?
```

---

## 50. Reference Architecture: Regulatory Review Task

### 50.1 BPMN Flow

```text
Application Submitted
  -> Determine Review Assignment
  -> Officer Review User Task
       boundary non-interrupting timer: reminder after 3 working days
       boundary non-interrupting timer: notify supervisor after 5 working days
       boundary interrupting timer: escalate after 10 working days
  -> Gateway reviewOutcome
       APPROVE -> Supervisor Approval
       REQUEST_CLARIFICATION -> Applicant Clarification Subprocess
       REJECT -> Rejection Preparation
```

### 50.2 Domain Tables

```text
application
review_decision
review_draft
application_audit_event
task_audit_event
workflow_outbox
sla_deadline
assignment_decision
```

### 50.3 Process Variables

```json
{
  "applicationId": "APP-2026-000123",
  "reviewAssignment": {
    "candidateGroups": ["licensing-officer-east"],
    "dueDate": "2026-06-24T17:00:00+08:00",
    "priority": 80
  },
  "reviewOutcome": "APPROVE",
  "reviewDecisionId": "REV-2026-000123"
}
```

### 50.4 Completion Flow

```text
User submits review decision
  -> Backend validates task + domain authorization
  -> Backend persists review decision
  -> Backend updates application state
  -> Backend appends audit event
  -> Backend inserts workflow outbox complete-task command
  -> Dispatcher completes user task
  -> BPMN continues
```

---

## 51. Top 1% Engineering Heuristics

1. User task is a wait state, not a screen.
2. Task assignment is not authorization.
3. Candidate group is not enough for domain access.
4. Domain command should complete task, not generic task completion endpoint.
5. Domain DB stores legal/audit truth; process variables store routing context.
6. Completion should be idempotent and recoverable.
7. SLA must distinguish due date metadata from BPMN timer behavior.
8. Reassignment is a business event, not just metadata update.
9. Maker-checker must be enforced in domain policy, not just diagram shape.
10. Human workflow must be observable by team, task type, age, SLA, and outcome.
11. If an auditor asks “why did this happen?”, your model should answer without reading code.
12. If operations asks “what is stuck?”, your model should answer without database archaeology.
13. If business asks “can policy change next month?”, your assignment/SLA/approval model should not require rewriting the whole process.

---

## 52. Ringkasan

Human workflow adalah bagian paling business-critical dari BPMN/Camunda system karena di sinilah manusia membuat keputusan yang mengubah nasib process dan domain entity.

User task yang baik memiliki:

```text
clear purpose
clear assignment
clear authorization
clear form contract
clear SLA
clear completion semantics
clear audit trail
clear repair path
```

User task yang buruk terlihat mudah di awal, tetapi menciptakan masalah besar:

```text
unowned backlog
unclear accountability
weak authorization
unexplained decisions
SLA breach invisible
process-domain mismatch
regulatory audit gap
```

Untuk menjadi engineer level tinggi di workflow/case-management system, kamu harus melihat user task sebagai gabungan dari:

```text
runtime wait state
work queue item
authorization boundary
domain command trigger
SLA object
audit event source
human accountability point
```

Jika mental model ini benar, Camunda bukan hanya task list. Camunda menjadi bagian dari arsitektur yang dapat mengoordinasikan manusia, sistem, deadline, keputusan, dan audit secara eksplisit.

---

## 53. Latihan

### Latihan 1 — Design Assignment

Ambil proses `Review Application`.

Desain:

```text
candidate group
assignee rule
fallback rule
SLA
priority
reassignment rule
```

Untuk tiga kasus:

1. low-risk application;
2. high-risk application;
3. application from restricted region.

### Latihan 2 — Maker-checker

Desain flow:

```text
Officer prepares recommendation
Supervisor approves
Director approves only if high risk
```

Tentukan:

```text
BPMN elements
process variables
DB tables
authorization checks
audit events
```

### Latihan 3 — Clarification Timeout

Desain flow applicant clarification dengan:

```text
14 calendar days deadline
reminder after 7 days
auto close after 14 days
supervisor override possible
```

Tentukan kapan memakai:

```text
task due date
boundary timer
SLA service
domain status
```

### Latihan 4 — Stale Submit

Desain API behavior jika user submit form tetapi task sudah completed oleh user lain.

Tentukan:

```text
HTTP status
error code
user message
audit event
frontend behavior
```

---

## 54. Koneksi ke Part Berikutnya

Part berikutnya membahas:

# Part 11 — DMN and Decision Engineering: Separating Flow from Decision Logic

Human workflow sering rusak karena terlalu banyak decision logic dimasukkan ke gateway dan expression di BPMN. Part berikutnya akan membahas bagaimana memisahkan:

```text
process flow
human task
business decision
policy rule
routing rule
approval matrix
SLA decision
```

Dengan DMN, FEEL, decision table, decision audit, dan governance rule yang lebih kuat.

---

## 55. Status Seri

Seri belum selesai.

Selesai sejauh ini:

1. Part 0 — Orientation: Dari CRUD Engineer ke Process Orchestration Engineer
2. Part 1 — BPMN 2.0 Deep Semantics: Bukan Diagram, Tapi Execution Contract
3. Part 2 — BPMN Core Elements: Events, Tasks, Gateways, Subprocesses
4. Part 3 — BPMN Modeling Discipline: Membuat Process Model yang Bisa Hidup di Production
5. Part 4 — Camunda Landscape: Camunda 7 vs Camunda 8
6. Part 5 — Camunda 8 Runtime Internals: Zeebe Mental Model
7. Part 6 — Java Client Engineering: From API Call to Production-grade Worker
8. Part 7 — Job Worker Reliability: Idempotency, Retry, Backoff, Poison Jobs
9. Part 8 — Process Variables: Data Contract, Scope, Serialization, and Governance
10. Part 9 — BPMN Error, Technical Failure, Incident, Escalation, and Compensation
11. Part 10 — Human Workflow: User Task, Assignment, Forms, SLA, and Authorization

Berikutnya:

12. Part 11 — DMN and Decision Engineering: Separating Flow from Decision Logic

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-09-bpmn-error-technical-failure-incident-escalation-compensation.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-11-dmn-decision-engineering-separating-flow-from-decision-logic.md)

</div>