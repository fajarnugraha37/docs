# learn-java-camunda-7-bpm-platform-engineering-part-015.md

# Part 015 — Human Task Engineering: Task Lifecycle, Assignment, Candidate Groups, Authorization, and Work Queue Design

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Bagian: `015`  
> Topik: Human Task Engineering di Camunda 7 BPM Platform  
> Target: Java 8–25, Camunda Platform 7.x, enterprise/regulatory workflow, production-grade engineering

---

## 0. Posisi Bagian Ini dalam Seri

Pada bagian sebelumnya kita sudah membahas:

- engine architecture,
- execution tree,
- transaction boundary,
- async continuation,
- job executor,
- database schema,
- optimistic locking,
- variable system,
- expression/delegation binding,
- extension points,
- external task,
- service invocation,
- message correlation,
- timer/SLA.

Sekarang kita masuk ke salah satu fitur yang sering terlihat sederhana tetapi justru paling berbahaya bila dimodelkan sembarangan: **human task**.

Dalam Camunda 7, `userTask` bukan hanya “to-do item”. Ia adalah:

1. **wait state** dalam process execution,
2. **runtime entity** di database,
3. **unit of work manusia**,
4. **authorization surface**,
5. **audit event**,
6. **work queue item**,
7. **coordination point** antara process state, user identity, business rule, SLA, dan UI.

Engineer pemula sering melihat user task sebagai form screen. Engineer senior melihat user task sebagai **human decision boundary** yang harus benar secara transaksi, ownership, authorization, escalation, audit, dan recovery.

---

## 1. Core Mental Model

### 1.1 User Task adalah Wait State

Ketika process execution mencapai user task, engine tidak “menjalankan manusia”. Engine melakukan ini:

1. membuat runtime task entity,
2. menyimpan state process instance,
3. menyimpan assignment/candidate/due date/variables yang relevan,
4. commit transaction,
5. berhenti.

Process tidak lanjut sampai task diselesaikan lewat API seperti:

```java
taskService.complete(taskId);
```

atau:

```java
taskService.complete(taskId, variables);
```

Jadi user task adalah **durable pause point**.

Konsekuensinya:

- task bisa hidup selama menit, hari, bulan, bahkan tahun,
- process instance tetap ada di runtime tables,
- task bisa diklaim, diassign ulang, didelegasikan, atau dicancel karena process path berubah,
- task completion adalah transaction baru yang dapat gagal/rollback,
- side effect setelah completion bisa rollback process ke user task bila belum ada async boundary.

---

### 1.2 User Task Bukan Authorization Model Lengkap

Assignment/candidate group di user task sering disalahpahami sebagai security enforcement penuh.

Yang benar:

- `assignee` menjelaskan siapa yang sedang bertanggung jawab,
- `candidateUsers`/`candidateGroups` menjelaskan siapa yang dapat menjadi kandidat pengerja,
- authorization Camunda menentukan permission user terhadap resource,
- application/UI layer tetap harus enforce business-level access control.

Dengan kata lain:

```text
candidate group != full authorization boundary
assignee != proof user may perform every business action
Tasklist visibility != regulatory authorization guarantee
```

Untuk sistem enterprise/regulatory, jangan hanya bergantung pada candidate group. Biasanya perlu kombinasi:

- Camunda authorization,
- identity provider groups/roles,
- application authorization policy,
- domain-level ownership check,
- task-variable-based case access,
- audit logging.

---

### 1.3 User Task adalah Human Workflow Contract

Satu user task menyatakan:

> Pada state proses ini, manusia dengan kualifikasi tertentu harus melakukan aksi tertentu, dalam batas waktu tertentu, dengan informasi tertentu, menghasilkan keputusan tertentu, dan semua itu harus bisa diaudit.

Jadi desain user task harus menjawab:

| Pertanyaan | Contoh |
|---|---|
| Apa pekerjaan manusia? | Review application, approve enforcement action, request clarification |
| Siapa yang boleh melihat? | Assigned officer, supervisor group, admin role |
| Siapa yang boleh mengklaim? | Candidate group tertentu |
| Siapa yang boleh menyelesaikan? | Assignee atau role khusus |
| Apa input yang dibutuhkan? | Case summary, evidence, previous decision |
| Apa output yang valid? | approve/reject/request-info/escalate |
| Apa SLA-nya? | Due in 5 working days |
| Apa escalation path? | Notify supervisor, reassign, create escalation task |
| Apa audit trail-nya? | Who did what, when, why, with which evidence |

Kalau model tidak menjawab pertanyaan ini, user task hanya menjadi “kotak manual” yang rapuh.

---

## 2. User Task Entity dan Runtime State

Saat user task aktif, Camunda menyimpan runtime task di tabel seperti:

```text
ACT_RU_TASK
```

Selain itu, ia biasanya terkait dengan:

```text
ACT_RU_EXECUTION       active execution waiting at user task
ACT_RU_VARIABLE        process/task variables
ACT_RU_IDENTITYLINK    candidate users/groups, assignee-related links
ACT_RU_EVENT_SUBSCR    if user task has event-related boundary/event subprocess relation
ACT_RU_JOB             if task has timer boundary or async continuation nearby
ACT_RU_INCIDENT        if failure/incident exists near execution/job
```

History-nya dapat muncul di:

```text
ACT_HI_TASKINST        historic task instance
ACT_HI_ACTINST         activity instance history
ACT_HI_VARINST         variable history
ACT_HI_DETAIL          variable update/detail history depending history level
ACT_HI_OP_LOG          user operation log depending operation/auth context
```

> Penting: jangan mutate tabel runtime task secara manual. Gunakan `TaskService`, `RuntimeService`, atau API resmi lain. Manual DB update dapat merusak execution tree, identity link, history, authorization, dan command context assumptions.

---

## 3. Lifecycle User Task

### 3.1 High-Level Lifecycle

Secara konseptual:

```text
process reaches user task
        |
        v
task created
        |
        +--> visible to candidates / assignee
        |
        +--> claimed / assigned
        |
        +--> worked by human
        |
        +--> completed with variables
        |
        v
process continues
```

Tetapi real lifecycle lebih luas:

```text
create
  -> assignment changes
  -> claim
  -> unclaim
  -> delegate
  -> resolve
  -> complete
  -> delete/cancel because process moved/cancelled
```

Task juga bisa hilang bukan karena user complete, tetapi karena:

- boundary event interrupting triggered,
- process instance cancelled/deleted,
- parent scope ended,
- process instance modification,
- compensation/cancellation path,
- migration issue,
- terminate end event.

---

### 3.2 `create` Event

Task created ketika execution mencapai user task.

Pada titik ini biasanya terjadi:

- assignee expression dievaluasi,
- candidate user/group expression dievaluasi,
- due date/follow-up date expression dievaluasi,
- task listener `create` dijalankan,
- runtime task row dibuat.

Contoh BPMN XML sederhana:

```xml
<bpmn:userTask id="reviewApplication" name="Review Application"
               camunda:candidateGroups="application-reviewer"
               camunda:dueDate="${slaDueDate}">
</bpmn:userTask>
```

Risiko:

- expression error membuat task creation gagal,
- task tidak pernah muncul karena transaction rollback,
- task listener melakukan side effect lalu task creation rollback,
- candidate group salah menyebabkan task tidak terlihat di UI,
- due date null/salah timezone menyebabkan SLA kacau.

---

### 3.3 Claim

Claim berarti user mengambil tanggung jawab task.

```java
taskService.claim(taskId, userId);
```

Efek konseptual:

```text
ASSIGNEE_ = userId
```

Claim biasanya dipakai untuk task dari candidate group.

Contoh:

```java
Task task = taskService.createTaskQuery()
    .taskCandidateGroup("application-reviewer")
    .singleResult();

taskService.claim(task.getId(), "fajar");
```

Makna bisnis:

> User `fajar` sekarang bertanggung jawab menyelesaikan task.

Engineering concern:

- dua user bisa mencoba claim task yang sama,
- claim harus atomic,
- UI harus handle race condition,
- audit harus mencatat siapa claim dan kapan,
- claim bukan berarti user boleh melakukan semua aksi domain.

---

### 3.4 Unclaim

Unclaim melepaskan assignee sehingga task kembali ke candidate pool.

```java
taskService.setAssignee(taskId, null);
```

Use case:

- user salah claim,
- user cuti/resign,
- task stuck,
- supervisor rebalancing workload.

Anti-pattern:

- user bisa unclaim setelah mulai kerja tanpa audit/reason,
- task bolak-balik claim/unclaim tanpa SLA policy,
- tidak ada operation log di application layer.

---

### 3.5 Assign

Assign berarti set assignee langsung.

```java
taskService.setAssignee(taskId, "officer-123");
```

Berbeda dari claim:

- claim biasanya self-service dari candidate pool,
- assign biasanya dilakukan sistem/supervisor/routing policy.

Dalam enterprise workflow, assignment sering dihasilkan dari:

- workload balancing,
- case ownership,
- organization hierarchy,
- skill/role matrix,
- conflict-of-interest rule,
- availability calendar,
- round robin,
- supervisor override.

Jangan taruh semua logic ini sebagai expression BPMN panjang. Lebih baik panggil assignment policy service.

---

### 3.6 Delegate dan Resolve

Delegation di Camunda punya makna khusus.

Misalnya officer A punya task tetapi butuh bantuan officer B. A bisa delegate task ke B. B menyelesaikan bagian bantuan dengan `resolve`, lalu task kembali ke owner/original responsible user.

Secara konseptual:

```text
A owns task
A delegates to B
B resolves task
A completes final task
```

API umum:

```java
taskService.delegateTask(taskId, "officer-b");

taskService.resolveTask(taskId);
```

Use case:

- officer utama minta supporting assessment,
- legal officer memberi advice,
- supervisor meminta rework sebelum final decision.

Jangan gunakan delegation bila sebenarnya workflow membutuhkan state eksplisit seperti:

```text
Review -> Legal Assessment -> Supervisor Approval -> Final Decision
```

Untuk proses regulatory, sering lebih defensible memakai explicit BPMN tasks daripada hidden delegation, karena audit dan state transitions lebih jelas.

---

### 3.7 Complete

Complete menandakan human work selesai dan process execution lanjut.

```java
taskService.complete(taskId);
```

atau dengan variables:

```java
Map<String, Object> variables = new HashMap<>();
variables.put("reviewDecision", "APPROVE");
variables.put("reviewComment", "All required documents are complete");

taskService.complete(taskId, variables);
```

Completion adalah command/transaction baru.

Yang terjadi:

1. task dicari,
2. permission/authorization dicek bila enabled dan context tersedia,
3. variables diset,
4. task listener `complete` dieksekusi,
5. task runtime dihapus,
6. history ditulis,
7. execution lanjut ke node berikutnya,
8. transaksi commit atau rollback.

Poin kritis:

> Jika setelah completion ada synchronous service task yang gagal, transaction bisa rollback dan task dapat muncul kembali.

Contoh:

```text
User Task -> Service Task Send Email -> End
```

Jika user complete task, lalu `Send Email` gagal dalam transaction yang sama, completion rollback. User melihat task masih ada.

Solusi desain:

```text
User Task -> asyncBefore Service Task Send Email -> End
```

atau:

```text
User Task -> Outbox Write -> End
```

---

## 4. Assignment Model

Camunda user task memiliki beberapa konsep assignment:

| Konsep | Makna |
|---|---|
| assignee | user yang bertanggung jawab saat ini |
| owner | original owner / owner dalam delegation scenario |
| candidate user | user yang dapat menjadi kandidat |
| candidate group | group yang dapat mengerjakan task |
| identity link | relation antara task dan user/group dengan tipe tertentu |

---

### 4.1 Assignee

Assignee cocok bila sejak awal sudah jelas siapa yang harus mengerjakan task.

```xml
<bpmn:userTask id="review" name="Review"
               camunda:assignee="${assignedOfficerId}" />
```

Kelebihan:

- jelas siapa bertanggung jawab,
- work queue personal mudah,
- SLA individual mudah.

Kekurangan:

- risk jika user unavailable,
- assignment expression harus valid,
- rebalancing perlu mekanisme tambahan.

---

### 4.2 Candidate Group

Candidate group cocok untuk pool task.

```xml
<bpmn:userTask id="review" name="Review"
               camunda:candidateGroups="application-reviewer" />
```

Query:

```java
List<Task> tasks = taskService.createTaskQuery()
    .taskCandidateGroup("application-reviewer")
    .list();
```

Flow umum:

```text
candidate group task -> user claims -> assignee task -> user completes
```

Kelebihan:

- workload sharing,
- tidak perlu assign user di process creation,
- cocok untuk queue operations.

Kekurangan:

- task bisa tidak diklaim lama,
- race saat claim,
- group membership harus dikelola benar,
- candidate group bukan jaminan authorization penuh.

---

### 4.3 Candidate User

Candidate user cocok untuk subset spesifik user.

```xml
<bpmn:userTask id="review" name="Review"
               camunda:candidateUsers="${candidateOfficerIds}" />
```

Use case:

- hanya officer tertentu yang qualified,
- conflict-of-interest filtering,
- panel reviewer,
- special assignment queue.

Risiko:

- terlalu banyak identity link,
- update kandidat setelah task dibuat perlu API,
- group-based design biasanya lebih scalable.

---

### 4.4 Dynamic Assignment via TaskListener

Contoh:

```java
public class AssignmentTaskListener implements TaskListener {
  private final AssignmentPolicy assignmentPolicy;

  public AssignmentTaskListener(AssignmentPolicy assignmentPolicy) {
    this.assignmentPolicy = assignmentPolicy;
  }

  @Override
  public void notify(DelegateTask delegateTask) {
    String caseType = (String) delegateTask.getVariable("caseType");
    String region = (String) delegateTask.getVariable("region");

    AssignmentResult result = assignmentPolicy.assign(caseType, region);

    if (result.assignee() != null) {
      delegateTask.setAssignee(result.assignee());
    } else {
      for (String group : result.candidateGroups()) {
        delegateTask.addCandidateGroup(group);
      }
    }
  }
}
```

BPMN:

```xml
<bpmn:userTask id="review" name="Review Application">
  <bpmn:extensionElements>
    <camunda:taskListener event="create"
                          delegateExpression="${assignmentTaskListener}" />
  </bpmn:extensionElements>
</bpmn:userTask>
```

Poin desain:

- listener hanya adapter,
- policy ada di application service,
- hasil assignment harus auditable,
- jangan query banyak data tanpa index,
- jangan panggil remote service lambat di task creation transaction tanpa timeout/circuit-breaker/async boundary.

---

## 5. Task Queries dan Work Queue Design

### 5.1 Personal Inbox

```java
List<Task> myTasks = taskService.createTaskQuery()
    .taskAssignee("fajar")
    .orderByTaskDueDate()
    .asc()
    .list();
```

Cocok untuk:

- task yang sudah di-claim,
- personal responsibility,
- direct assignment.

---

### 5.2 Group Queue

```java
List<Task> groupTasks = taskService.createTaskQuery()
    .taskCandidateGroup("application-reviewer")
    .orderByTaskCreateTime()
    .asc()
    .list();
```

Cocok untuk:

- unclaimed queue,
- team-based processing,
- claim-based work distribution.

---

### 5.3 Candidate or Assigned Query

Sering UI perlu menampilkan task yang:

- assigned to user, atau
- candidate untuk user/group.

Hati-hati: query seperti ini bisa mahal bila terlalu dinamis, terutama bila user punya banyak group.

Pattern umum:

1. resolve user group dari identity provider/application,
2. query assigned tasks,
3. query candidate tasks by groups,
4. merge/sort di application layer atau buat search projection.

Untuk volume besar, jangan mengandalkan TaskService query mentah sebagai search engine utama. Buat projection table/search index untuk task inbox.

---

### 5.4 Work Queue Projection Pattern

Untuk enterprise UI, sering lebih baik membuat projection:

```text
workflow_task_projection
- task_id
- process_instance_id
- business_key
- case_id
- module
- task_name
- assignee
- candidate_groups
- priority
- due_date
- follow_up_date
- created_at
- status
- case_title
- applicant_name
- risk_level
- sla_status
```

Projection ini diisi dari:

- task listener,
- history/event listener,
- polling task query,
- domain event outbox,
- custom synchronization job.

Kenapa perlu projection?

- UI butuh filter kompleks,
- Camunda query bukan full-text search,
- candidate/authorization rules sering domain-specific,
- Tasklist enterprise biasanya butuh join ke case/application/customer/evidence,
- query langsung ke engine tables bisa mahal dan coupled ke internal schema.

Rule:

> Camunda runtime DB adalah source of truth process state. Projection adalah read model untuk UI/search/reporting, bukan replacement engine state.

---

## 6. Due Date, Follow-Up Date, Priority, and SLA

### 6.1 Due Date Bukan Timer

User task due date adalah metadata task.

```xml
<bpmn:userTask id="review" name="Review"
               camunda:dueDate="${reviewDueDate}" />
```

Due date berguna untuk:

- sorting queue,
- display SLA,
- report overdue,
- filtering.

Tetapi due date sendiri tidak otomatis menjalankan escalation path. Untuk executable escalation, modelkan timer boundary/event subprocess.

```text
User Task Review
  + boundary timer after P5D -> Escalate
```

---

### 6.2 Follow-Up Date

Follow-up date biasa dipakai untuk menyatakan kapan task perlu mulai diperhatikan.

Contoh:

- task dibuat hari ini,
- baru perlu action 3 hari lagi,
- due dalam 10 hari.

Work queue dapat menyembunyikan task sebelum follow-up date kecuali user mencari secara eksplisit.

---

### 6.3 Priority

Task priority bisa dipakai untuk sorting/rebalancing.

Contoh:

```java
taskService.setPriority(taskId, 80);
```

Priority harus punya policy jelas:

| Priority | Makna |
|---|---|
| 100 | statutory deadline breached/critical enforcement |
| 80 | high-risk case |
| 50 | normal |
| 20 | low priority/backlog |

Anti-pattern:

- semua task priority high,
- priority diset dari UI bebas tanpa audit,
- priority tidak memengaruhi queue/supervision,
- priority menggantikan SLA state.

---

## 7. User Task Completion Contract

### 7.1 Completion Harus Punya Valid Output

Task completion tidak boleh hanya:

```java
taskService.complete(taskId);
```

untuk task yang memerlukan keputusan.

Lebih baik:

```java
Map<String, Object> variables = Map.of(
    "reviewDecision", "REQUEST_INFO",
    "reviewReason", "Missing supporting document",
    "reviewedBy", currentUserId,
    "reviewedAt", Instant.now().toString()
);

taskService.complete(taskId, variables);
```

Tetapi jangan simpan semua audit sebagai process variables. Untuk enterprise system, simpan audit/domain decision di domain tables juga.

Pattern:

```text
UI submit decision
  -> application validates permission
  -> application writes domain decision/audit in app DB
  -> application completes Camunda task with compact variables
  -> process routes based on decision
```

---

### 7.2 Completion Transaction Boundary

Jika aplikasi memakai same transaction dengan Camunda engine, maka domain write dan task completion dapat atomic.

Contoh ideal dalam Spring:

```java
@Transactional
public void completeReview(String taskId, ReviewCommand command, UserContext user) {
  Task task = taskService.createTaskQuery()
      .taskId(taskId)
      .singleResult();

  if (task == null) {
    throw new TaskNotFoundException(taskId);
  }

  authorizationPolicy.assertCanComplete(user, task, command);

  reviewRepository.save(ReviewDecision.from(command, user));

  Map<String, Object> variables = new HashMap<>();
  variables.put("reviewDecision", command.decision().name());
  variables.put("reviewDecisionId", command.decisionId());

  taskService.complete(taskId, variables);
}
```

Risiko:

- if process continuation after completion calls remote service synchronously, transaction becomes fragile,
- rollback can undo domain decision and task completion,
- user may retry and create duplicate decision if idempotency missing.

Better:

```text
User Task complete
  -> commit decision
  -> async boundary
  -> remote side effects later
```

---

### 7.3 Validate Before Complete

Task completion should validate:

- task exists,
- task active,
- user can see task,
- user can complete task,
- user is assignee or allowed override role,
- input decision is allowed for current task/state,
- mandatory fields complete,
- no stale form version,
- no concurrent completion already happened.

Do not rely only on BPMN gateway expression to reject invalid input after completion. Validate before state transition.

---

## 8. Authorization and Security

### 8.1 Camunda Authorization vs Business Authorization

Camunda authorization manages access to Camunda resources such as:

- process definition,
- process instance,
- task,
- deployment,
- decision definition,
- tenant,
- application.

But business authorization may involve:

- case ownership,
- agency/unit hierarchy,
- role scope,
- conflict of interest,
- sensitivity level,
- region/branch,
- applicant relationship,
- investigation secrecy,
- delegated authority threshold.

Example:

```text
User belongs to enforcement-officer group
but cannot access Case A because it belongs to another branch
or because user previously handled applicant profile
or because decision amount exceeds delegation threshold.
```

This cannot be solved by candidate group alone.

---

### 8.2 Recommended Layering

```text
[External Identity Provider]
  users, groups, organization, roles
        |
        v
[Application Authorization]
  domain policy: case access, task action, delegation threshold
        |
        v
[Camunda Authorization]
  engine resource permissions
        |
        v
[Camunda Task Assignment]
  assignee/candidate/owner as workflow responsibility
```

Each layer answers different question:

| Layer | Question |
|---|---|
| Identity | Who is this user? |
| Application authorization | What business actions may user perform? |
| Camunda authorization | What engine resources may user access? |
| Task assignment | Who is responsible/candidate for this work item? |

---

### 8.3 Never Expose Raw Task Completion Endpoint Without Policy

Bad:

```http
POST /engine-rest/task/{taskId}/complete
```

exposed directly to browser/user without domain policy.

Better:

```http
POST /api/cases/{caseId}/tasks/{taskId}/review-decision
```

Application endpoint performs:

1. authentication,
2. domain authorization,
3. task lookup,
4. task-case binding check,
5. input validation,
6. idempotency check,
7. domain write/audit,
8. Camunda task completion.

---

### 8.4 Task ID Guessing Risk

Task IDs are not authorization. Never assume random-looking id is safe.

Check:

```java
Task task = taskService.createTaskQuery()
    .taskId(taskId)
    .singleResult();

if (!Objects.equals(task.getProcessInstanceId(), expectedProcessInstanceId)) {
  throw new AccessDeniedException("Task does not belong to this case");
}
```

Also validate business key/case id:

```java
ProcessInstance pi = runtimeService.createProcessInstanceQuery()
    .processInstanceId(task.getProcessInstanceId())
    .singleResult();

if (!Objects.equals(pi.getBusinessKey(), caseId)) {
  throw new AccessDeniedException("Task-case mismatch");
}
```

---

## 9. Forms and UI Integration

### 9.1 Camunda Forms vs Custom Forms

Camunda 7 supports form-related concepts, but enterprise applications often build custom UI.

Custom UI benefits:

- richer validation,
- domain-specific layout,
- better authorization integration,
- audit capture,
- case context rendering,
- attachment/evidence integration,
- design system compliance.

But custom UI must not bypass workflow correctness.

---

### 9.2 Task Form Contract

A task form should be treated as contract:

```text
taskDefinitionKey: reviewApplication
formVersion: 3
allowedActions:
  - APPROVE
  - REJECT
  - REQUEST_INFO
requiredInputs:
  - decision
  - comment if REJECT or REQUEST_INFO
outputs:
  - reviewDecision
  - reviewReason
  - reviewDecisionId
```

Do not hardcode UI behavior purely from task name.

Bad:

```text
if task.name contains "Review" show review form
```

Better:

```text
if task.taskDefinitionKey == "reviewApplication" and formKey == "application-review:v3"
```

---

### 9.3 Form Versioning

Long-running processes mean task created today may be completed months later.

If UI form changes, old task may still expect old variable names.

Mitigation:

- include form version,
- support backward-compatible payloads,
- avoid deleting action semantics,
- use DTO mapping layer,
- avoid directly binding UI JSON to process variables,
- test old task completion after new deployment.

---

## 10. Task Variables

### 10.1 Task Local Variables

Task local variables belong to task scope.

Use for:

- draft form state,
- temporary UI state,
- task-specific metadata,
- partial review notes.

Example:

```java
taskService.setVariableLocal(taskId, "draftComment", "Need to check attachment A");
```

But be careful:

- task local variables may disappear when task completes,
- history behavior depends history level,
- not always suitable for process routing,
- not suitable as authoritative domain decision record.

---

### 10.2 Process Variables from Task Completion

Use for process routing:

```java
variables.put("decision", "APPROVE");
```

Gateway:

```xml
<bpmn:sequenceFlow id="approveFlow" sourceRef="review" targetRef="approve">
  <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">
    ${decision == 'APPROVE'}
  </bpmn:conditionExpression>
</bpmn:sequenceFlow>
```

Do not store full UI payload as process variable unless necessary.

Better:

```text
process variable:
  decision = APPROVE
  decisionId = DEC-123

domain table:
  full decision text
  structured criteria
  attachments
  evidence references
  actor
  timestamp
  signature metadata
```

---

## 11. Task Listener Discipline

Task listeners can run on events such as create, assignment, complete, update, delete.

### 11.1 Good Use Cases

- apply assignment policy,
- set due date/follow-up date,
- set priority,
- emit audit metadata,
- update task projection,
- validate task completion metadata,
- add candidate groups dynamically.

### 11.2 Bad Use Cases

- perform core business decision invisibly,
- send email synchronously without idempotency,
- call slow remote service in same transaction,
- mutate many process variables in hidden way,
- replace explicit BPMN steps,
- implement large workflow branch logic.

Rule:

> If a human/business reviewer would expect to see it in the process model, do not hide it in task listener.

---

## 12. Regulatory Workflow Example

Suppose we model enforcement case review.

### 12.1 Naive Model

```text
Start -> Review Case -> Approve/Reject -> End
```

Problems:

- no assignment rule,
- no SLA,
- no escalation,
- no four-eyes approval,
- no audit policy,
- no rework path,
- no domain decision record,
- no conflict-of-interest handling.

---

### 12.2 Better Model

```text
Start Enforcement Review
  -> Assign Reviewing Officer
  -> User Task: Review Case
       boundary timer: SLA Warning
       boundary timer: SLA Breach Escalation
  -> Gateway: Review Decision
       APPROVE -> User Task: Supervisor Approval
       REQUEST_INFO -> User Task: Request Clarification
       REJECT -> User Task: Supervisor Approval if high impact
  -> Record Final Decision
  -> Notify Parties async
  -> End
```

Key state variables:

```text
caseId
reviewDecision
reviewDecisionId
reviewRiskLevel
requiresSupervisorApproval
slaProfileId
assignedOfficerId
```

Domain tables:

```text
case_review_decision
case_audit_event
case_assignment
case_sla_event
case_evidence_reference
```

Camunda tasks represent workflow state; domain tables represent authoritative business evidence.

---

## 13. Race Conditions and Concurrency

### 13.1 Double Complete

Two requests complete same task:

```text
User double-clicks submit
Browser retries POST
Mobile and desktop both submit
Supervisor completes while officer submits
```

Possible outcomes:

- first succeeds, second gets task not found,
- optimistic locking exception,
- duplicate domain write if not protected.

Mitigation:

- idempotency key per submit,
- disable UI submit after first click,
- unique constraint on decision command id,
- check task active before completion,
- handle `NotFoundException` as possible idempotent success if command already processed.

---

### 13.2 Claim Race

Two users claim the same candidate task.

Mitigation:

- let engine atomic claim decide,
- UI handles failure gracefully,
- refresh queue after claim failure,
- do not pre-reserve task in UI without server-side lock.

---

### 13.3 Assignment Drift

User sees task in queue; before submit, supervisor reassigns/cancels task.

Mitigation:

- reload task at submit,
- validate assignee/candidate/permission at submit,
- return clear error:

```text
This task is no longer assigned to you or is no longer active.
```

---

## 14. Completion Side Effects

Bad pattern:

```text
User Task -> Service Task Send Email -> End
```

synchronous service after user task can cause task completion rollback if email service fails.

Better:

```text
User Task -> asyncBefore Send Email -> End
```

or:

```text
User Task -> Write Outbox -> End
External publisher sends email
```

Best for regulatory systems:

```text
User Task complete
  -> write decision audit
  -> commit workflow state
  -> async notification job/outbox
  -> retry/incident independent from decision completion
```

Human decision should not be undone because a notification failed.

---

## 15. Auditability

For user tasks, audit should answer:

- who saw the task,
- who claimed it,
- who reassigned it,
- who completed it,
- what decision was made,
- what evidence was used,
- what version of form/policy was used,
- what variables changed,
- whether SLA was met,
- whether override occurred,
- why override occurred.

Camunda history helps, but enterprise audit often needs domain-specific audit.

Example audit event:

```json
{
  "eventType": "TASK_COMPLETED",
  "caseId": "CASE-2026-0001",
  "taskId": "abc123",
  "taskDefinitionKey": "reviewApplication",
  "actorUserId": "officer-17",
  "decision": "REQUEST_INFO",
  "decisionId": "DEC-7788",
  "reasonCode": "MISSING_DOCUMENT",
  "timestamp": "2026-06-20T10:15:30Z",
  "formVersion": "application-review:v3",
  "policyVersion": "assignment-policy:2026.2"
}
```

---

## 16. Workload Management

### 16.1 Queue Metrics

Track:

- open tasks by group,
- open tasks by assignee,
- overdue tasks,
- tasks nearing SLA,
- average claim time,
- average completion time,
- reassignment count,
- delegation count,
- task aging buckets,
- tasks by process definition version,
- tasks by case risk.

### 16.2 Stuck Task Detection

A task may be stuck if:

- unclaimed too long,
- assigned user inactive,
- due date breached,
- no update for N days,
- candidate group no longer exists,
- assignee no longer exists,
- task belongs to suspended process definition/instance,
- process version obsolete and no migration path.

Diagnostic query via API:

```java
List<Task> overdue = taskService.createTaskQuery()
    .dueBefore(new Date())
    .active()
    .list();
```

Then enrich from domain case data.

---

## 17. Operational Recovery

### 17.1 Reassign Task

```java
taskService.setAssignee(taskId, "new-officer");
```

Use with audit:

```text
reason: officer unavailable
approvedBy: supervisor-01
oldAssignee: officer-17
newAssignee: officer-22
```

### 17.2 Add Candidate Group

```java
taskService.addCandidateGroup(taskId, "senior-reviewer");
```

### 17.3 Remove Candidate Group

```java
taskService.deleteCandidateGroup(taskId, "junior-reviewer");
```

### 17.4 Delete Task?

Avoid direct delete unless you know whether it should affect process state. For BPMN user tasks inside process instances, process state should usually move via:

- complete,
- boundary event,
- process instance modification,
- cancellation path,
- process instance deletion.

Direct task deletion can create confusing process state if misused.

---

## 18. Java 8–25 Considerations

Camunda 7 deployments may span old Java 8 estates up to newer Java versions depending Camunda/Spring/container support.

Human task code itself is mostly ordinary Java, but design differs by runtime generation.

### Java 8 baseline

- avoid records/sealed classes,
- use immutable DTO manually,
- be careful with old date/time interop,
- use `java.time` where possible but convert to `Date` for Camunda API fields when needed.

### Java 11/17

- better TLS/security baseline,
- better container ergonomics,
- can use modern libraries depending Camunda/Spring compatibility.

### Java 21+

- virtual threads may help application request handling, but do not change Camunda transaction semantics,
- do not assume virtual threads make blocking task completion side effects safe,
- still need async boundary/outbox/idempotency,
- verify support matrix for your exact Camunda 7 distribution/runtime.

### Java 25 planning

- treat as forward-looking application/platform planning,
- validate dependencies, bytecode target, Spring/container compatibility,
- Camunda 7 version support must be checked before runtime upgrade.

---

## 19. Common Anti-Patterns

### 19.1 “Everything Is a User Task”

Symptoms:

- process becomes manual workflow for every operation,
- automation missing,
- users manually compensate system integration failures,
- SLA depends on humans for deterministic machine work.

Fix:

- separate machine task vs human decision,
- automate deterministic checks,
- use user task only for human judgment/approval/exception handling.

---

### 19.2 “One Generic Review Task for Everything”

Symptoms:

```text
User Task: Review
with huge form and many buttons
```

Problems:

- unclear state,
- hard audit,
- hidden branching in UI,
- complicated authorization,
- impossible metrics.

Fix:

- split meaningful states,
- use taskDefinitionKey-specific contracts,
- keep UI action set explicit.

---

### 19.3 Assignment Logic in BPMN Expression Soup

Bad:

```xml
camunda:assignee="${caseType == 'A' ? userService.pickA(region) : userService.pickB(priority, branch, risk)}"
```

Fix:

```xml
<camunda:taskListener event="create" delegateExpression="${assignmentTaskListener}" />
```

with tested assignment policy service.

---

### 19.4 Raw Engine REST from Frontend

Bad:

```text
Vue/React -> Camunda REST directly
```

Problems:

- task id exposure,
- insufficient domain authorization,
- variable injection risk,
- hard audit,
- UI coupled to engine API,
- no idempotency layer.

Fix:

```text
Frontend -> Application API -> Domain policy + Camunda API
```

---

### 19.5 User Task as Data Store

Bad:

- storing all form data only as process variables,
- no domain table,
- no normalized decision/evidence model,
- no queryable business state.

Fix:

- Camunda stores routing facts,
- domain DB stores authoritative business records,
- task projection supports UI/search.

---

## 20. Production-Grade Task Completion Service Example

```java
public final class CompleteReviewTaskCommand {
  private final String taskId;
  private final String caseId;
  private final String idempotencyKey;
  private final ReviewDecision decision;
  private final String reason;
  private final String formVersion;

  public CompleteReviewTaskCommand(
      String taskId,
      String caseId,
      String idempotencyKey,
      ReviewDecision decision,
      String reason,
      String formVersion
  ) {
    this.taskId = Objects.requireNonNull(taskId);
    this.caseId = Objects.requireNonNull(caseId);
    this.idempotencyKey = Objects.requireNonNull(idempotencyKey);
    this.decision = Objects.requireNonNull(decision);
    this.reason = reason;
    this.formVersion = Objects.requireNonNull(formVersion);
  }

  public String taskId() { return taskId; }
  public String caseId() { return caseId; }
  public String idempotencyKey() { return idempotencyKey; }
  public ReviewDecision decision() { return decision; }
  public String reason() { return reason; }
  public String formVersion() { return formVersion; }
}
```

Service:

```java
@Transactional
public ReviewCompletionResult completeReview(
    CompleteReviewTaskCommand command,
    UserContext user
) {
  IdempotencyRecord existing = idempotencyStore.find(command.idempotencyKey());
  if (existing != null) {
    return existing.toReviewCompletionResult();
  }

  Task task = taskService.createTaskQuery()
      .taskId(command.taskId())
      .active()
      .singleResult();

  if (task == null) {
    throw new TaskNotFoundOrInactiveException(command.taskId());
  }

  if (!"reviewApplication".equals(task.getTaskDefinitionKey())) {
    throw new InvalidTaskTypeException(task.getTaskDefinitionKey());
  }

  CaseRecord caseRecord = caseRepository.findById(command.caseId())
      .orElseThrow(() -> new CaseNotFoundException(command.caseId()));

  taskBindingPolicy.assertTaskBelongsToCase(task, caseRecord);
  authorizationPolicy.assertCanCompleteReview(user, task, caseRecord, command);
  reviewInputValidator.validate(command, caseRecord);

  ReviewDecisionRecord decisionRecord = reviewDecisionRepository.save(
      ReviewDecisionRecord.create(
          caseRecord.id(),
          task.getId(),
          user.userId(),
          command.decision(),
          command.reason(),
          command.formVersion(),
          clock.instant()
      )
  );

  Map<String, Object> variables = new HashMap<>();
  variables.put("reviewDecision", command.decision().name());
  variables.put("reviewDecisionId", decisionRecord.id());
  variables.put("reviewCompletedBy", user.userId());

  taskService.complete(task.getId(), variables);

  ReviewCompletionResult result = ReviewCompletionResult.completed(
      task.getId(),
      caseRecord.id(),
      decisionRecord.id()
  );

  idempotencyStore.save(command.idempotencyKey(), result);

  return result;
}
```

Poin desain:

- idempotency checked first,
- task active check,
- task type check,
- case-task binding check,
- business authorization check,
- domain decision saved,
- Camunda completion receives compact variables,
- result saved for retry-safe submission.

---

## 21. SQL Diagnostics

> Gunakan hanya untuk diagnosis. Jangan update manual.

### 21.1 Active Tasks

```sql
SELECT
  ID_,
  NAME_,
  TASK_DEF_KEY_,
  ASSIGNEE_,
  OWNER_,
  CREATE_TIME_,
  DUE_DATE_,
  FOLLOW_UP_DATE_,
  PRIORITY_,
  PROC_INST_ID_,
  EXECUTION_ID_
FROM ACT_RU_TASK
ORDER BY CREATE_TIME_ DESC;
```

### 21.2 Candidate Groups/Users

```sql
SELECT
  TASK_ID_,
  USER_ID_,
  GROUP_ID_,
  TYPE_
FROM ACT_RU_IDENTITYLINK
WHERE TASK_ID_ = :taskId;
```

### 21.3 Task + Process Instance

```sql
SELECT
  t.ID_ AS task_id,
  t.NAME_ AS task_name,
  t.TASK_DEF_KEY_,
  t.ASSIGNEE_,
  t.CREATE_TIME_,
  t.DUE_DATE_,
  e.PROC_INST_ID_,
  e.BUSINESS_KEY_
FROM ACT_RU_TASK t
JOIN ACT_RU_EXECUTION e
  ON t.PROC_INST_ID_ = e.PROC_INST_ID_
WHERE t.ID_ = :taskId;
```

### 21.4 Historic Task Timeline

```sql
SELECT
  ID_,
  PROC_INST_ID_,
  TASK_DEF_KEY_,
  NAME_,
  ASSIGNEE_,
  OWNER_,
  START_TIME_,
  END_TIME_,
  DURATION_,
  DELETE_REASON_
FROM ACT_HI_TASKINST
WHERE PROC_INST_ID_ = :processInstanceId
ORDER BY START_TIME_;
```

---

## 22. Checklist: Designing a User Task

Before adding a user task, answer:

1. What exact human decision/action is required?
2. Why cannot this be automated?
3. Who can see it?
4. Who can claim it?
5. Who can complete it?
6. Who can reassign/delegate it?
7. What input data is displayed?
8. What output variables are produced?
9. What domain records are written?
10. What audit event is produced?
11. What SLA applies?
12. What happens on SLA warning?
13. What happens on SLA breach?
14. What happens if assignee leaves?
15. What happens if task is completed twice?
16. What happens if task disappears while form is open?
17. What happens if process version changes?
18. What happens if form version changes?
19. What authorization policy applies?
20. What metrics will be monitored?

---

## 23. Mental Model Summary

User task is not UI. User task is **human-controlled state transition**.

A production-grade user task needs:

```text
state clarity
+ assignment policy
+ authorization policy
+ form contract
+ completion validation
+ domain audit
+ process variables
+ SLA model
+ escalation path
+ recovery operation
+ observability
+ versioning strategy
```

The central discipline:

> Camunda should manage process state; your application should manage business authority, domain evidence, user experience, and security policy.

---

## 24. Part 015 Key Takeaways

1. User task is a durable wait state, not just a to-do item.
2. `assignee`, `candidateUsers`, and `candidateGroups` express workflow responsibility, not full business authorization.
3. Task completion is a transaction that can rollback if downstream synchronous work fails.
4. Human decision should be stored in domain/audit tables, not only as process variables.
5. Due date is metadata; executable escalation needs timer modelling.
6. Work queue UI often needs projection/read model beyond raw TaskService query.
7. Direct frontend-to-engine REST is dangerous for enterprise systems.
8. Task form must be versioned and bound to `taskDefinitionKey`/form key, not task name.
9. Race conditions around claim/complete are normal; design idempotency and optimistic handling.
10. Good human task design is about correctness, responsibility, auditability, and recovery.

---

## 25. References

- Camunda 7.24 Manual — User Task BPMN Reference: https://docs.camunda.org/manual/7.24/reference/bpmn20/tasks/user-task/
- Camunda 7.24 Manual — Task Service / Process Engine API: https://docs.camunda.org/manual/7.24/user-guide/process-engine/process-engine-api/
- Camunda 7.24 Javadocs — TaskService: https://docs.camunda.org/javadoc/camunda-bpm-platform/7.24/org/camunda/bpm/engine/TaskService.html
- Camunda 7.24 Javadocs — DelegateTask: https://docs.camunda.org/javadoc/camunda-bpm-platform/7.24/org/camunda/bpm/engine/delegate/DelegateTask.html
- Camunda 7.24 Manual — Authorization Service: https://docs.camunda.org/manual/7.24/user-guide/process-engine/authorization-service/
- Camunda 7.24 Manual — Database Schema: https://docs.camunda.org/manual/7.24/user-guide/process-engine/database/database-schema/
- Camunda 7.24 Manual — Transactions in Processes: https://docs.camunda.org/manual/7.24/user-guide/process-engine/transactions-in-processes/
- Camunda Docs — Extending Human Task Management in Camunda 7: https://docs.camunda.io/docs/8.7/components/best-practices/architecture/extending-human-task-management-c7/

---

## 26. Status

`part-015` selesai.

Seri belum selesai. Lanjut ke:

```text
learn-java-camunda-7-bpm-platform-engineering-part-016.md
```

Topik berikutnya:

```text
History, Auditability, Regulatory Traceability, dan Data Retention
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-014.md">⬅️ Timers, Due Dates, Time Zones, Calendar Semantics, dan SLA Modelling</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-016.md">Part 016 — History, Auditability, Regulatory Traceability, dan Data Retention ➡️</a>
</div>
