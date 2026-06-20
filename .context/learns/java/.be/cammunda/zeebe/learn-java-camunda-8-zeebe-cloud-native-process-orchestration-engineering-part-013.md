# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-013.md

# Part 013 — User Tasks, Tasklist, Forms, Assignment, Candidate Groups, and Human Workflow Architecture

> Seri: **learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering**  
> Bagian: **013 / 035**  
> Fokus: **human workflow architecture di Camunda 8**  
> Target: Java engineer / tech lead yang ingin mampu mendesain, mengimplementasikan, mengoperasikan, dan mengaudit workflow manusia di Camunda 8 secara production-grade.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kita tidak hanya ingin "tahu user task". Kita ingin punya mental model yang cukup kuat untuk menjawab pertanyaan-pertanyaan seperti:

1. Apa sebenarnya user task di Camunda 8?
2. Apa bedanya user task sebagai BPMN element, task record di engine, projection di Tasklist, dan pekerjaan nyata manusia di organisasi?
3. Kapan cukup memakai Tasklist bawaan, kapan perlu custom task inbox/case UI?
4. Bagaimana mendesain assignee, candidate users, candidate groups, due date, follow-up date, form, dan variable mapping agar aman untuk production?
5. Bagaimana menghindari workflow yang terlihat benar di diagram tetapi buruk untuk operasi harian?
6. Bagaimana mengintegrasikan user task dengan enterprise IAM, RBAC/ABAC, case management, audit trail, SLA, dan regulatory defensibility?
7. Bagaimana memikirkan human workflow ketika engine Zeebe tetap merupakan distributed orchestration engine, bukan relational task engine seperti Camunda 7?

Bagian ini sengaja tidak mengulang BPMN basic. Fokusnya adalah runtime semantics, desain arsitektur, dan failure model.

---

## 1. Mental Model Utama

### 1.1 User task bukan sekadar “step manual”

Di workflow production, user task adalah titik tempat sistem menyerahkan sebagian kontrol kepada manusia.

Secara sederhana:

```text
Automated service task:
  Engine creates job -> worker executes -> worker completes/fails job

User task:
  Engine creates human task -> task appears in task application/projection -> human claims/works/completes -> process continues
```

Namun secara arsitektural, user task jauh lebih kompleks daripada service task karena melibatkan:

- authorization;
- assignment;
- queue management;
- SLA;
- form rendering;
- validation;
- decision capture;
- audit trail;
- reassignment;
- escalation;
- operational workload balancing;
- human error;
- organization structure;
- temporary delegation;
- maker-checker controls;
- regulatory evidence.

Service task biasanya gagal karena system dependency. User task sering gagal karena **human organization design**.

Contoh:

```text
Bukan hanya:
  "Officer reviews application"

Tetapi:
  Which officer?
  From which unit?
  Based on which role?
  Can they see this applicant's data?
  Can they claim it?
  Can they return it?
  Can supervisor reassign it?
  Is conflict-of-interest checked?
  What is the due date?
  What happens if deadline passes?
  What evidence is captured when they approve/reject?
  Is the reason mandatory?
  Can the task be completed from a stale UI screen?
```

Top-level engineer tidak mendesain user task sebagai kotak BPMN. Ia mendesain **human work protocol**.

---

### 1.2 Empat level realitas user task

Untuk tidak bingung, pisahkan empat realitas ini:

```text
Level 1 — BPMN model
  User task element in process definition.

Level 2 — Engine state
  Runtime task state produced by Zeebe/Camunda engine.

Level 3 — Projection/application view
  Tasklist or custom task application reads task projection.

Level 4 — Organizational work
  A real person receives, claims, reviews, decides, escalates, or rejects.
```

Kesalahan umum adalah menganggap Level 3 sama dengan Level 2, atau Level 2 sama dengan Level 4.

Contoh bug mental model:

```text
"Task is visible in Tasklist, therefore it is the source of truth."
```

Lebih akurat:

```text
Tasklist is a task application/projection over runtime task data.
The process engine remains the orchestration authority.
The organization remains the work authority.
```

Dalam Camunda 8, read-side visibility dapat memiliki projection lag. Karena itu, desain workflow tidak boleh bergantung pada asumsi bahwa UI projection selalu konsisten secara instan dengan command path engine.

---

### 1.3 User task sebagai contract, bukan UI detail

User task harus diperlakukan sebagai contract antara process model dan human work system.

Contract itu mencakup:

| Area | Pertanyaan desain |
|---|---|
| Identity | Siapa boleh melihat/claim/complete task? |
| Assignment | Apakah task assigned langsung atau masuk candidate pool? |
| Data | Data apa yang dibutuhkan untuk mengambil keputusan? |
| Form | Input apa yang wajib, optional, readonly, calculated? |
| Decision | Output keputusan apa yang valid? |
| SLA | Kapan task harus dikerjakan? |
| Escalation | Apa yang terjadi saat overdue? |
| Audit | Bukti apa yang harus terekam? |
| Security | Data mana yang harus disembunyikan/dimasking? |
| Versioning | Apa yang terjadi saat form/process berubah sementara task lama masih hidup? |

Jika contract tidak jelas, issue akan muncul di UAT/production, bukan saat compile.

---

## 2. User Task di Camunda 8: Konsep dan Perbedaan dari Camunda 7

### 2.1 Camunda 7 mental model

Di Camunda 7, user task sangat dekat dengan relational engine.

Karakteristik umum:

- engine sering embedded atau dekat dengan aplikasi Java;
- task disimpan di relational DB engine;
- banyak aplikasi memakai TaskService API secara langsung;
- query task sering dilakukan langsung ke engine API;
- listener/delegate sering berjalan dalam boundary transaksi engine;
- custom task app sering dibangun langsung di atas engine API.

Mental model yang sering terbentuk:

```text
My Java app talks to engine DB/API and manages tasks directly.
```

### 2.2 Camunda 8 mental model

Di Camunda 8, Zeebe/Camunda engine adalah distributed orchestration engine. User task menjadi bagian dari stream/state engine, sementara Tasklist adalah application/projection untuk human work.

Mental model yang lebih tepat:

```text
Process model defines user task.
Engine creates and transitions task state.
Tasklist/custom UI exposes task work to users.
Task completion command returns control to process execution.
```

Implikasi penting:

1. Jangan membawa semua kebiasaan Camunda 7 TaskService ke Camunda 8.
2. Jangan menganggap semua query relational-style tersedia atau cocok.
3. Jangan menyembunyikan complex business authorization di BPMN expression tanpa governance.
4. Jangan menjadikan Tasklist sebagai satu-satunya domain case management system jika kebutuhan case jauh lebih kompleks.

---

## 3. Anatomy of a User Task

Sebuah user task production biasanya memiliki elemen-elemen berikut:

```text
User Task
├─ Identity contract
│  ├─ assignee
│  ├─ candidate users
│  └─ candidate groups
├─ Scheduling contract
│  ├─ due date
│  └─ follow-up date
├─ Form contract
│  ├─ form id/key
│  ├─ schema
│  ├─ validation
│  └─ version
├─ Data contract
│  ├─ input variables
│  ├─ local variables
│  └─ output variables
├─ Lifecycle contract
│  ├─ create
│  ├─ assign/claim
│  ├─ update
│  ├─ complete
│  └─ cancel/terminate
├─ Audit contract
│  ├─ who
│  ├─ when
│  ├─ what decision
│  ├─ reason/evidence
│  └─ before/after snapshot
└─ Operational contract
   ├─ escalation
   ├─ reassignment
   ├─ workload queue
   └─ supervisor intervention
```

BPMN box hanya menampilkan sebagian kecil dari kontrak ini.

---

## 4. Assignment Model

### 4.1 Direct assignee

Direct assignee berarti task diarahkan kepada satu user tertentu.

Contoh konseptual:

```text
assignee = "alice"
```

Cocok jika:

- task merupakan follow-up dari ownership yang sudah jelas;
- case officer sudah ditentukan sebelumnya;
- ada rule assignment eksplisit;
- task adalah personal action;
- perlu akuntabilitas individual sejak awal.

Risiko:

- user cuti/resign;
- workload imbalance;
- bottleneck individu;
- task stuck karena tidak ada fallback;
- assignment rule menjadi terlalu kaku.

Gunakan direct assignee jika ownership memang bagian dari domain, bukan karena malas mendesain queue.

---

### 4.2 Candidate users

Candidate users berarti beberapa user tertentu boleh mengambil task.

```text
candidateUsers = ["alice", "bob", "carol"]
```

Cocok jika:

- daftar eligible users kecil;
- assignment perlu precise;
- tidak ada group identity yang stabil;
- case-level access ditentukan secara dinamis.

Risiko:

- list cepat stale;
- sulit maintain jika organization berubah;
- kurang scalable untuk enterprise;
- raw username/id bisa tersebar di process variable/model.

Candidate users baik untuk dynamic but bounded eligibility, bukan untuk menggantikan group/role model enterprise.

---

### 4.3 Candidate groups

Candidate groups berarti task masuk pool group tertentu.

```text
candidateGroups = ["licensing-officer", "senior-reviewer"]
```

Cocok jika:

- task dikerjakan oleh role/team;
- queue-based operation;
- workload balancing;
- shift-based assignment;
- supervisor dapat reassign;
- enterprise IAM memiliki group mapping yang jelas.

Risiko:

- group terlalu besar sehingga task ownership kabur;
- group terlalu kecil sehingga bottleneck;
- group string tidak sinkron dengan IAM;
- role bisnis dicampur dengan implementation group;
- authorization diasumsikan hanya dari candidate group padahal data access lebih kompleks.

Candidate group adalah model paling umum untuk human workflow enterprise, tetapi harus didesain sebagai bagian dari **organization operating model**, bukan hanya field BPMN.

---

### 4.4 Assignee vs candidate: ownership transition

Pola umum:

```text
Task created with candidate group
        ↓
User claims task
        ↓
Task now has assignee
        ↓
User completes task
```

Ini memisahkan:

- eligibility: siapa boleh mengambil task;
- ownership: siapa sedang bertanggung jawab;
- completion authority: siapa boleh menyelesaikan task.

Dalam back-office operation, pola claim ini biasanya lebih sehat daripada langsung assign semua task ke individu.

---

## 5. Claim, Assign, Return, Unassign: Human Work Lifecycle

### 5.1 Lifecycle konseptual

User task lifecycle dapat dipahami sebagai state machine:

```text
CREATED / AVAILABLE
    ↓ claim/assign
ASSIGNED
    ↓ complete
COMPLETED
```

Dengan jalur tambahan:

```text
ASSIGNED
    ↓ return/unassign
AVAILABLE

AVAILABLE or ASSIGNED
    ↓ process cancellation / boundary event / termination
CANCELED
```

Dalam implementasi modern, user task lifecycle juga memiliki event seperti creating, assigning, updating, completing, dan canceling. Untuk custom task app, memahami lifecycle ini penting agar UI tidak mengizinkan aksi yang tidak valid.

### 5.2 Claim

Claim berarti user mengambil ownership task dari candidate pool.

Gunakan claim saat:

- task berada di shared queue;
- user memilih pekerjaan dari inbox;
- assignment individual dimulai saat user benar-benar mulai bekerja.

Risiko claim:

- user claim lalu tidak mengerjakan;
- user claim terlalu banyak task;
- user lupa return;
- supervisor tidak punya dashboard ownership.

Mitigasi:

- max active claimed tasks per user;
- auto-escalation jika claimed tetapi tidak ada update;
- supervisor reassignment;
- follow-up date;
- claimed-age dashboard.

### 5.3 Assign

Assign berarti task diberikan ke user tertentu, biasanya oleh system/supervisor/rule.

Gunakan assign saat:

- automatic assignment rule jelas;
- supervisor membagikan workload;
- case officer ownership sudah diketahui;
- task harus diarahkan ke specialist.

### 5.4 Return / unassign

Return/unassign penting untuk real operation.

Contoh alasan:

- user salah claim;
- conflict of interest;
- user cuti;
- task butuh specialist;
- task harus kembali ke queue.

Design smell:

```text
Task can be claimed but cannot be returned.
```

Ini sering menghasilkan hidden operational debt.

---

## 6. Tasklist: Kapan Cukup, Kapan Tidak

### 6.1 Apa yang Tasklist berikan

Tasklist adalah aplikasi untuk bekerja dengan human tasks. Secara umum, Tasklist menyediakan kemampuan seperti:

- melihat task yang tersedia;
- claim/assign/complete task;
- melihat form;
- mengisi form;
- menjalankan process start form jika diberi akses;
- bekerja dengan task berdasarkan assignment/candidate;
- document/form interaction pada batasan tertentu;
- integrasi dengan identity/authorization platform.

Tasklist sangat berguna untuk:

- workflow standar;
- approval sederhana-menengah;
- task queue internal;
- prototype sampai production jika kebutuhan UI tidak terlalu domain-specific;
- mengurangi biaya membangun inbox sendiri.

### 6.2 Kapan Tasklist cukup

Tasklist biasanya cukup jika:

1. task UI terutama form-based;
2. data context dapat ditampilkan lewat form;
3. authorization mengikuti user/group standard;
4. tidak perlu complex case timeline;
5. tidak perlu multi-panel domain workspace;
6. tidak perlu highly customized workload dashboard;
7. tidak perlu deep integration dengan domain-specific action buttons;
8. tidak ada requirement UI yang sangat berbeda dari Tasklist.

Contoh:

```text
- Simple leave approval
- Procurement approval
- Basic KYC manual review
- Internal exception handling
- Data verification step
```

### 6.3 Kapan perlu custom task application

Custom task application lebih tepat jika:

1. task adalah bagian dari complex case management;
2. user perlu melihat banyak entity lintas module;
3. ada complex RBAC/ABAC;
4. task action tidak hanya complete form;
5. perlu embedded document viewer, evidence manager, correspondence history;
6. perlu split screen, timeline, audit, notes, SLA widget;
7. task harus berinteraksi dengan domain service secara intensif;
8. perlu custom workload distribution;
9. process task hanya salah satu dari banyak sumber pekerjaan;
10. regulasi mengharuskan audit/decision capture yang sangat spesifik.

Contoh regulatory case UI:

```text
Case Workspace
├─ Case summary
├─ Applicant profile
├─ License history
├─ Documents
├─ Correspondence
├─ Audit timeline
├─ Risk indicators
├─ Related cases
├─ Current process task
├─ Decision form
├─ Internal notes
└─ Enforcement action panel
```

Untuk model seperti ini, Tasklist bisa tetap dipakai oleh operasi sederhana, tetapi custom case UI biasanya lebih natural.

### 6.4 Hybrid pattern

Pola hybrid umum:

```text
Tasklist:
  - generic back-office tasks
  - operations fallback
  - admin/support visibility

Custom case UI:
  - high-volume officer workflow
  - domain-rich decision tasks
  - regulatory workspace
```

Dalam hybrid, pastikan command completion tetap konsisten. Jangan sampai user bisa menyelesaikan task dari dua UI dengan validasi berbeda.

---

## 7. Forms: Lebih dari Sekadar Input Field

### 7.1 Form sebagai decision contract

Form bukan hanya tampilan. Form adalah kontrak input manusia.

Form harus menjawab:

- data apa yang user lihat;
- data mana readonly;
- data mana editable;
- validasi apa yang wajib;
- output variable apa yang dihasilkan;
- reason/evidence apa yang disimpan;
- bagaimana perubahan form memengaruhi running task;
- bagaimana audit trail menangkap keputusan.

Contoh buruk:

```json
{
  "approved": true,
  "remarks": "ok"
}
```

Contoh lebih baik:

```json
{
  "reviewDecision": {
    "decision": "APPROVED",
    "reasonCode": "REQUIREMENTS_MET",
    "remarks": "All mandatory documents verified.",
    "reviewedDocumentIds": ["DOC-1001", "DOC-1002"],
    "riskAssessmentVersion": "2026-06-01",
    "submittedAt": "2026-06-21T10:15:00+07:00"
  }
}
```

Yang kedua lebih defensible karena menjelaskan keputusan dan bukti yang dipakai.

---

### 7.2 Embedded Camunda forms vs external forms

Secara konseptual:

| Pilihan | Cocok untuk | Risiko |
|---|---|---|
| Embedded/Camunda Form | standard form task, quick delivery, low custom UI | terbatas untuk complex workspace |
| External/custom form | rich domain UI, custom validation, deep integration | perlu build auth, validation, API, audit sendiri |
| Hybrid | simple fields di Tasklist + link ke domain UI | user experience bisa terpecah |

Gunakan Camunda forms ketika form memang workflow-form centric.
Gunakan custom UI ketika user sebenarnya butuh case workspace.

---

### 7.3 Form schema versioning

Task bisa hidup lama. Form bisa berubah. Ini menciptakan masalah versioning.

Pertanyaan wajib:

```text
Jika task dibuat dengan form v1,
lalu process/form dideploy ulang ke v2,
form mana yang harus user lihat?
```

Strategi:

1. Form version pinned by process deployment.
2. Task payload menyimpan `formVersion`.
3. Custom UI membaca version dan render sesuai schema.
4. Backend completion endpoint menerima versioned payload.
5. Migration task/form dilakukan eksplisit.

Contoh contract:

```json
{
  "taskContractVersion": "application-review.v3",
  "decision": "APPROVE",
  "reasonCode": "DOCS_COMPLETE",
  "remarks": "Verified."
}
```

---

### 7.4 Validation placement

Validasi form tidak cukup hanya di frontend.

Layer validasi:

```text
Frontend form validation
  Fast feedback, UX, required field, format.

Task completion API validation
  Security boundary. Never trust browser.

Domain validation
  Business invariants.

Process validation
  Ensures output variables match BPMN path expectations.
```

Anti-pattern:

```text
Tasklist form ensures required fields, therefore backend can trust completion payload.
```

Lebih benar:

```text
Form validation improves UX.
Backend/domain validation protects correctness.
```

---

## 8. Variable Mapping untuk User Task

### 8.1 Input variables

User task tidak perlu semua process variables. Ia perlu subset yang relevan untuk decision.

Contoh buruk:

```text
Expose all process variables to task form.
```

Risiko:

- PII leakage;
- payload besar;
- UI coupling ke internal variables;
- accidental overwrite;
- sulit evolve schema;
- user melihat data yang tidak diperlukan.

Contoh lebih baik:

```json
{
  "taskContext": {
    "applicationNo": "APP-2026-0001",
    "applicantName": "...",
    "licenseType": "...",
    "submittedAt": "...",
    "riskLevel": "MEDIUM",
    "requiredActions": ["VERIFY_DOCUMENTS", "CHECK_ELIGIBILITY"]
  }
}
```

### 8.2 Output variables

Output user task harus diperlakukan sebagai command/result dari manusia.

Contoh:

```json
{
  "reviewResult": {
    "decision": "REQUEST_MORE_INFO",
    "reasonCode": "MISSING_DOCUMENT",
    "requestedDocumentTypes": ["BANK_STATEMENT"],
    "remarks": "Latest bank statement is missing."
  }
}
```

Jangan membuat output ambiguous:

```json
{
  "status": "done"
}
```

Status `done` tidak memberi makna bisnis.

### 8.3 Local variables vs process variables

Pikirkan scope.

Gunakan local variables untuk:

- temporary form state;
- task-specific display data;
- values not needed downstream;
- values that should not pollute process root.

Gunakan process variables untuk:

- routing decision;
- downstream worker input;
- audit-relevant process facts;
- business state update.

Design heuristic:

```text
If downstream BPMN path or worker needs it, make it explicit process output.
If only the task UI needs it, keep it local/display-side.
```

---

## 9. Human Decision Modelling

### 9.1 Jangan modelling approval sebagai boolean saja

Boolean approval terlalu miskin untuk workflow serius.

Buruk:

```json
{
  "approved": false
}
```

Lebih baik:

```json
{
  "decision": "REJECTED",
  "reasonCode": "ELIGIBILITY_NOT_MET",
  "reasonDetails": "Applicant does not meet minimum experience requirement.",
  "evidenceRefs": ["DOC-5521", "RULE-CHECK-2026-09"],
  "nextAction": "NOTIFY_APPLICANT"
}
```

Boolean tidak menjawab:

- kenapa;
- berdasarkan bukti apa;
- apakah bisa appeal;
- apakah perlu refund;
- apakah perlu enforcement;
- apakah rejection karena incomplete atau ineligible.

### 9.2 Decision taxonomy

Contoh decision taxonomy untuk review:

```text
APPROVE
REJECT
REQUEST_MORE_INFORMATION
ESCALATE
RETURN_TO_PREVIOUS_OFFICER
REFER_TO_LEGAL
REFER_TO_ENFORCEMENT
WITHDRAW
SUSPEND
```

Masing-masing decision harus punya semantics jelas.

| Decision | Meaning | BPMN effect |
|---|---|---|
| APPROVE | Requirements fulfilled | Continue to issuance/next review |
| REJECT | Cannot proceed | Notify, close, appeal window |
| REQUEST_MORE_INFORMATION | Missing data | Send request, wait response |
| ESCALATE | Needs higher authority | Supervisor review |
| RETURN_TO_PREVIOUS_OFFICER | Correction needed | Loop back |
| REFER_TO_LEGAL | Legal review needed | Call legal subprocess |

### 9.3 Reason code governance

Reason code harus governed.

Jangan gunakan free-text sebagai satu-satunya reason.

Pola baik:

```json
{
  "decision": "REJECT",
  "reasonCode": "DOCUMENT_FORGED",
  "remarks": "Signature mismatch detected during verification."
}
```

Reason code mendukung:

- analytics;
- audit;
- reporting;
- consistent correspondence templates;
- appeal handling;
- regulatory defensibility.

---

## 10. Assignment Architecture in Enterprise Systems

### 10.1 Static assignment

Static assignment di BPMN:

```text
candidateGroups = licensing-officer
```

Cocok untuk simple workflow.

Kelemahan:

- organization change but BPMN needs redeploy;
- group mapping hardcoded;
- cannot express complex policy;
- difficult for tenant-specific assignment.

### 10.2 Variable-driven assignment

Assignment berdasarkan variable:

```text
candidateGroups = =assignedGroup
assignee = =caseOfficerId
```

Cocok jika group/user ditentukan oleh rule sebelumnya.

Contoh flow:

```text
Determine Assignment Rule
        ↓
Review Application User Task
```

Variable:

```json
{
  "assignment": {
    "candidateGroup": "senior-licensing-reviewer",
    "reason": "HIGH_RISK_APPLICATION",
    "ruleVersion": "assignment-policy-2026-06"
  }
}
```

### 10.3 DMN/rule-driven assignment

Untuk assignment kompleks, gunakan rule service/DMN-like decision sebelum user task.

Input:

```json
{
  "licenseType": "EA",
  "riskLevel": "HIGH",
  "region": "WEST",
  "amount": 250000,
  "applicantCategory": "CORPORATE"
}
```

Output:

```json
{
  "candidateGroup": "senior-ea-reviewer-west",
  "priority": 80,
  "dueInBusinessDays": 3,
  "requiresSupervisorReview": true
}
```

Keuntungan:

- assignment policy versioned;
- easier audit;
- easier testing;
- BPMN tetap bersih;
- business rule dapat diubah lebih terkontrol.

### 10.4 External workload engine

Untuk organisasi besar, assignment bisa dikelola oleh workforce/workload service.

Arsitektur:

```text
Zeebe process
  → service task: request assignment
  → workload service decides queue/user
  → user task uses assignment output
```

Workload service mempertimbangkan:

- user availability;
- leave calendar;
- skill;
- conflict-of-interest;
- current workload;
- SLA urgency;
- supervisor override;
- tenant/region;
- security clearance.

Ini jauh lebih maintainable daripada menaruh semua rule di BPMN expression.

---

## 11. Authorization: Candidate Group Bukan Seluruh Security Model

### 11.1 Eligibility vs data authorization

Candidate group menjawab:

```text
Who may work on this task?
```

Namun enterprise authorization juga harus menjawab:

```text
Can this user see this applicant data?
Can this user see confidential documents?
Can this user approve this monetary threshold?
Can this user handle cases from this region?
Is there conflict of interest?
Can this user perform this decision type?
```

Jadi jangan samakan candidate group dengan full authorization.

### 11.2 RBAC vs ABAC

RBAC:

```text
User has role SENIOR_REVIEWER.
Therefore can access senior review tasks.
```

ABAC:

```text
User can access case if:
  user.region == case.region
  and user.clearance >= case.sensitivity
  and user.department in allowedDepartments
  and user.id not in conflictOfInterestUsers
```

Regulatory/case systems sering membutuhkan ABAC atau hybrid RBAC+ABAC.

### 11.3 Custom task UI authorization

Jika membangun custom task UI, jangan hanya query tasks lalu tampilkan semua.

Pipeline aman:

```text
User identity
  ↓
Task query candidate/assignee filter
  ↓
Domain authorization filter
  ↓
Data masking filter
  ↓
Task action permission filter
```

Contoh:

```text
A user may see task summary but not confidential attachments.
A user may prepare recommendation but not approve.
A supervisor may reassign but not complete.
A legal officer may add opinion but not issue license.
```

---

## 12. Due Date, Follow-Up Date, Priority, and SLA

### 12.1 Due date bukan timer event

Due date adalah metadata task untuk manusia/Tasklist/UI.
Timer event adalah BPMN execution control.

Perbedaan:

| Konsep | Fungsi |
|---|---|
| Due date | Menunjukkan kapan task seharusnya selesai |
| Follow-up date | Menunjukkan kapan task perlu muncul/ditindaklanjuti |
| Timer boundary event | Mengubah alur proses jika waktu tercapai |
| Timer event subprocess | Menjalankan escalation/reminder path |

Jangan mengandalkan due date saja untuk escalation proses. Jika proses harus berubah ketika deadline lewat, modelkan timer boundary/event subprocess.

### 12.2 SLA model

SLA user task biasanya membutuhkan beberapa timestamp:

```json
{
  "sla": {
    "receivedAt": "2026-06-21T09:00:00+07:00",
    "dueAt": "2026-06-24T17:00:00+07:00",
    "warningAt": "2026-06-23T17:00:00+07:00",
    "escalateAt": "2026-06-25T09:00:00+07:00",
    "calendar": "SG_BUSINESS_DAY_V1"
  }
}
```

Task due date untuk UI. Timer untuk process behavior.

### 12.3 Priority

Priority berguna untuk sorting queue, tetapi jangan menggantikan SLA.

Priority bisa dihitung dari:

- risk level;
- due date proximity;
- case type;
- complainant sensitivity;
- statutory deadline;
- VIP/public impact;
- escalation count.

Contoh:

```text
priorityScore = base(caseType) + riskWeight + overdueWeight + escalationWeight
```

Namun priority harus explainable. Jika tidak, user tidak percaya queue ordering.

---

## 13. Escalation Patterns for Human Tasks

### 13.1 Reminder pattern

```text
User Task: Review Application
  └─ non-interrupting boundary timer after 2 days
        → Send reminder notification
```

Task tetap berjalan, reminder dikirim.

Cocok untuk:

- soft SLA;
- gentle reminder;
- no change of ownership.

### 13.2 Supervisor escalation pattern

```text
User Task: Review Application
  └─ non-interrupting boundary timer at due date
        → Create Supervisor Review/Escalation Task
```

Task asli masih ada, supervisor diberi visibility/intervention.

Cocok untuk:

- overdue but not auto-cancel;
- supervisor can reassign;
- human intervention needed.

### 13.3 Interrupting timeout pattern

```text
User Task: Submit Clarification
  └─ interrupting boundary timer after 14 days
        → Close as No Response
```

Task dibatalkan, process pindah path.

Cocok untuk:

- applicant gagal merespons dalam statutory window;
- deadline hard;
- task tidak lagi valid setelah timer.

### 13.4 Escalation ladder

```text
Day 1: available
Day 2: reminder
Day 3: supervisor notified
Day 5: reassigned
Day 7: management escalation
Day 14: process timeout path
```

Jangan modelkan semua escalation sebagai spaghetti BPMN. Untuk kompleksitas tinggi, gunakan escalation policy service.

---

## 14. Maker-Checker and Segregation of Duties

### 14.1 Basic maker-checker

```text
Prepare Recommendation  (Maker)
        ↓
Approve Recommendation  (Checker)
```

Invariant:

```text
checkerUserId != makerUserId
```

Simpan maker identity:

```json
{
  "maker": {
    "userId": "alice",
    "submittedAt": "2026-06-21T10:00:00+07:00"
  }
}
```

Kemudian assignment checker mengecualikan maker.

### 14.2 Common anti-pattern

```text
candidateGroup = senior-reviewer
```

Tetapi tidak ada pengecekan bahwa senior reviewer bukan maker.

Akibat:

- user bisa submit dan approve sendiri;
- audit finding;
- regulatory breach.

### 14.3 Enforcement pattern

Pengecekan bisa dilakukan di:

1. assignment service;
2. task completion validation;
3. domain authorization service;
4. BPMN gateway setelah completion.

Paling aman: enforce di backend/domain boundary, bukan hanya UI.

---

## 15. Delegation, Reassignment, and Substitution

### 15.1 Reassignment

Reassignment adalah operasi penting dalam production.

Alasan:

- user overloaded;
- user unavailable;
- wrong queue;
- skill mismatch;
- conflict-of-interest;
- urgent SLA.

Harus diaudit:

```json
{
  "action": "REASSIGN_TASK",
  "fromAssignee": "alice",
  "toAssignee": "bob",
  "performedBy": "supervisor1",
  "reasonCode": "USER_ON_LEAVE",
  "timestamp": "2026-06-21T11:30:00+07:00"
}
```

### 15.2 Delegation

Delegation berbeda dari reassignment.

Reassignment:

```text
Ownership moves from A to B.
```

Delegation:

```text
A remains accountable, B assists/performs part of work.
```

Camunda 8 Tasklist may not model every enterprise delegation nuance out-of-the-box. Jika organisasi membutuhkan true delegation semantics, custom task/case layer mungkin diperlukan.

### 15.3 Substitution

Substitution adalah rule sementara:

```text
If Alice is on leave from 2026-06-21 to 2026-06-28,
route Alice's new tasks to Bob or team queue.
```

Jangan hardcode substitution di BPMN. Gunakan workload/assignment service.

---

## 16. Custom Task Application Architecture

### 16.1 Basic architecture

```text
Browser / Case UI
    ↓
Task API / BFF
    ↓
Task Query Adapter  ──→ Tasklist API / Camunda APIs / read model
    ↓
Domain Authorization
    ↓
Domain Context Aggregator
    ↓
Task Action API
    ↓
Camunda Command API: assign/complete/etc.
```

BFF/custom API bertanggung jawab untuk:

- auth;
- filtering;
- masking;
- domain context aggregation;
- validation;
- command execution;
- audit;
- optimistic locking/user intent protection.

### 16.2 Do not expose raw task engine directly to browser

Anti-pattern:

```text
Frontend directly calls Camunda API with broad token.
```

Risiko:

- token leakage;
- privilege escalation;
- bypass domain validation;
- inconsistent audit;
- difficult masking;
- difficult tenant filtering.

Lebih baik:

```text
Frontend → your backend/BFF → Camunda API
```

Backend menggunakan service credential dengan controlled command wrapper.

### 16.3 Task query model

Untuk high-volume task UI, query pattern harus didesain.

Common filters:

- assignee = current user;
- candidate group in user groups;
- tenant;
- process id;
- task state;
- due date;
- priority;
- case type;
- region;
- risk level;
- created date;
- follow-up date.

Jika query perlu banyak domain field, mungkin perlu custom projection/index.

```text
Camunda task projection
  + domain case projection
  + authorization projection
  = operational inbox view
```

### 16.4 Custom projection pattern

Arsitektur:

```text
Zeebe exported records / Camunda APIs
        ↓
Task projection consumer
        ↓
Custom task_read_model table/index
        ↓
Case UI fast query
```

Gunakan jika:

- Tasklist query tidak cukup;
- perlu join dengan case domain;
- perlu custom sorting/filtering;
- perlu dashboard khusus;
- volume tinggi;
- regulatory inbox report.

Caution: custom projection harus dianggap read model, bukan source of truth.

---

## 17. Java Integration Patterns Around User Tasks

### 17.1 Worker before user task

Pola umum:

```text
Prepare Review Context (service task)
        ↓
Review Application (user task)
```

Worker menyiapkan:

- assignment;
- due date;
- form context;
- risk summary;
- document checklist;
- decision options.

Contoh output variable:

```json
{
  "reviewTask": {
    "candidateGroup": "licensing-reviewer",
    "dueAt": "2026-06-24T17:00:00+07:00",
    "priority": 70,
    "formVersion": "review-form.v4",
    "contextRef": "CASECTX-9912"
  }
}
```

### 17.2 Worker after user task

```text
Review Application (user task)
        ↓
Persist Review Decision (service task)
```

Kenapa perlu worker setelah user task?

- persist decision into domain DB;
- generate correspondence;
- update case status;
- publish domain event;
- validate final decision;
- trigger external integration.

Jangan selalu menaruh domain side effect langsung di task completion endpoint tanpa process clarity.

### 17.3 Completion command wrapper

Untuk custom UI, completion endpoint harus melakukan:

1. authenticate user;
2. authorize task access;
3. fetch/validate task state;
4. validate payload;
5. enforce business invariants;
6. write audit intent if required;
7. complete task with variables;
8. handle command failure;
9. return deterministic result to UI.

Pseudo Java:

```java
public CompleteTaskResult completeReviewTask(
        AuthenticatedUser user,
        String taskId,
        ReviewDecisionRequest request
) {
    TaskView task = taskQuery.getTask(taskId);

    authorization.assertCanComplete(user, task);
    reviewValidator.validate(request, task);
    segregationOfDuties.assertAllowed(user, task.caseId());

    Map<String, Object> variables = reviewMapper.toProcessVariables(request, user);

    // command wrapper, not raw UI call
    camundaTaskClient.complete(taskId, variables);

    audit.recordTaskCompleted(user, task, request);

    return CompleteTaskResult.accepted(taskId);
}
```

Note: ordering antara audit dan complete harus didesain dengan idempotency/outbox jika keduanya critical.

---

## 18. Optimistic Locking, Stale UI, and Double Submit

### 18.1 Stale UI problem

User membuka task jam 10:00. Supervisor reassign/cancel task jam 10:05. User submit jam 10:10.

Apa yang terjadi?

Jika sistem tidak mengecek task state, bisa muncul bug:

- task completed by wrong user;
- decision diterima setelah task obsolete;
- duplicate completion attempt;
- UI menampilkan sukses palsu.

### 18.2 Required checks

Task completion endpoint harus memvalidasi:

- task still exists;
- task still active;
- task assigned to user or user allowed;
- task version/state not changed unexpectedly;
- process instance not canceled;
- form version compatible;
- decision still valid.

### 18.3 Idempotent submit

Double click / retry browser / network retry bisa mengirim dua request.

Gunakan idempotency key:

```http
POST /tasks/{taskId}/complete
Idempotency-Key: 6a2f7b7e-...
```

Simpan:

```text
taskId + userId + idempotencyKey + requestHash + result
```

Jika request sama dikirim ulang, return result yang sama.
Jika request berbeda dengan key sama, reject.

---

## 19. Audit and Regulatory Defensibility

### 19.1 Audit minimum

Untuk human task, audit minimal harus menjawab:

```text
Who did what, when, on which case, from which task, with which decision, based on what visible data/evidence, and why?
```

Field audit:

```json
{
  "eventType": "USER_TASK_COMPLETED",
  "taskId": "...",
  "processInstanceKey": "...",
  "bpmnProcessId": "application-review",
  "taskDefinitionId": "ReviewApplicationTask",
  "caseId": "CASE-2026-0001",
  "performedBy": "alice",
  "performedAt": "2026-06-21T10:15:00+07:00",
  "decision": "APPROVE",
  "reasonCode": "REQUIREMENTS_MET",
  "remarks": "Verified mandatory documents.",
  "evidenceRefs": ["DOC-1", "DOC-2"],
  "formVersion": "review-form.v4",
  "taskContractVersion": "review-task.v3"
}
```

### 19.2 Audit source of truth

Camunda event records help reconstruct workflow history, but regulatory domain audit often needs additional business context.

Recommended split:

```text
Camunda history/projection:
  process/task lifecycle evidence

Domain audit table:
  business decision evidence

Document/evidence store:
  referenced supporting files

Correspondence log:
  notification/letters sent
```

Do not rely on one generic remarks field for everything.

### 19.3 Explainability

For enforcement/regulatory workflows, future reviewer must understand:

- why this user received the task;
- why the decision was allowed;
- what evidence was available;
- whether SLA was breached;
- whether breach was justified;
- who overrode/reassigned;
- whether maker-checker was respected.

This must be designed, not hoped for.

---

## 20. Human Workflow Failure Modes

### 20.1 Task invisible

Symptoms:

```text
Process instance waiting at user task, but user cannot see task.
```

Possible causes:

- wrong candidate group;
- identity group mapping mismatch;
- projection lag;
- tenant mismatch;
- authorization filter too strict;
- task created with unexpected assignment expression;
- user belongs to different realm/group naming convention;
- form/task app only queries assigned tasks, not candidate tasks.

Debug checklist:

1. Is process instance actually at user task?
2. Was task created?
3. What assignee/candidate groups were resolved?
4. What groups does user actually have?
5. Is Tasklist/custom UI filtering correctly?
6. Is tenant correct?
7. Is projection healthy?

### 20.2 Task visible to wrong users

Possible causes:

- candidate group too broad;
- missing ABAC filter;
- test group reused in prod;
- tenant missing;
- custom UI bypasses domain auth;
- group naming collision;
- inherited role too powerful.

Mitigation:

- least privilege group design;
- domain authorization after task query;
- tenant-aware filters;
- periodic access review;
- audit who viewed/completed sensitive task if required.

### 20.3 Task completed with invalid data

Possible causes:

- frontend-only validation;
- form version mismatch;
- domain invariant not enforced;
- stale UI;
- direct API access;
- custom UI and Tasklist validation differ.

Mitigation:

- backend validation;
- versioned payload;
- controlled completion API;
- idempotency;
- contract tests.

### 20.4 Task stuck forever

Possible causes:

- no due date;
- no escalation;
- user left company;
- group empty;
- all users unavailable;
- task assigned to disabled user;
- no supervisor dashboard.

Mitigation:

- due date;
- non-interrupting escalation;
- stale claimed task report;
- assignment health check;
- group membership monitor.

### 20.5 Task completed but process fails later

Possible causes:

- output variable missing;
- gateway expression fails;
- downstream worker rejects schema;
- domain persistence not done;
- error path not modelled.

Mitigation:

- task output contract;
- gateway expression tests;
- worker contract tests;
- explicit persist-decision service task;
- incident playbook.

---

## 21. Designing Human Workflow for Case Management

### 21.1 Process task vs case state

In complex case systems, a task is not the case.

```text
Case lifecycle:
  Draft → Submitted → Under Review → Pending Info → Approved → Issued → Suspended → Closed

Process task:
  One actionable work item at a point in that lifecycle.
```

Do not overload Camunda user task as the entire case domain model.

Recommended:

```text
Camunda:
  orchestrates lifecycle and work obligations

Case service:
  owns case aggregate/state/invariants

Task UI:
  exposes current actionable work
```

### 21.2 Case workspace pattern

```text
Case Workspace
├─ Header: status, SLA, owner, risk
├─ Current tasks
├─ Process timeline
├─ Domain timeline
├─ Documents/evidence
├─ Correspondence
├─ Notes
├─ Decision panel
└─ Audit trail
```

Task completion is one action inside workspace.

### 21.3 Cross-entity impact

Regulatory workflows often affect multiple entities:

- application;
- license;
- applicant profile;
- company;
- individual officer;
- compliance case;
- enforcement action;
- correspondence;
- payment/revenue;
- document repository.

User task should not directly mutate all of these without clear orchestration/persistence boundary.

Pattern:

```text
User completes decision task
        ↓
Process routes decision
        ↓
Service tasks update domain entities in controlled order
        ↓
Audit/correspondence/event publication
```

---

## 22. Task Priority and Workload Queue Design

### 22.1 Queue dimensions

A serious inbox usually has multiple queue dimensions:

```text
My Tasks
Team Queue
Overdue
Due Soon
High Risk
Escalated
Returned
Pending Clarification
Supervisor Queue
Specialist Queue
```

Tasklist may cover many normal task needs; custom projection may be needed for domain-rich queues.

### 22.2 Pull vs push assignment

Pull model:

```text
Task appears in team queue. User claims.
```

Pros:

- flexible;
- good for teams;
- handles absence.

Cons:

- cherry-picking;
- urgent tasks ignored;
- requires queue governance.

Push model:

```text
System assigns task to user.
```

Pros:

- clear accountability;
- workload distribution possible;
- useful for SLA.

Cons:

- assignment algorithm complexity;
- user absence issue;
- perceived unfairness if not explainable.

Hybrid:

```text
High priority tasks pushed.
Normal tasks pulled.
Overdue tasks escalated.
```

### 22.3 Cherry-picking prevention

If users can freely pick tasks, they may avoid difficult cases.

Mitigations:

- priority ordering;
- next-best-task recommendation;
- mandatory claim reason for skipping;
- supervisor dashboard;
- random assignment for certain queue;
- workload analytics;
- fairness policy.

---

## 23. Documents and Evidence in User Tasks

### 23.1 Do not store documents in process variables

Process variable should store references, not large binary/document content.

Good:

```json
{
  "documentRefs": [
    {
      "documentId": "DOC-1001",
      "type": "PASSPORT",
      "version": 3,
      "classification": "CONFIDENTIAL"
    }
  ]
}
```

Bad:

```json
{
  "passportPdfBase64": "...huge..."
}
```

### 23.2 Evidence snapshot

Decision should capture which version of document was reviewed.

```json
{
  "reviewedEvidence": [
    {
      "documentId": "DOC-1001",
      "documentVersion": 3,
      "hash": "sha256:..."
    }
  ]
}
```

This prevents ambiguity if document is replaced later.

---

## 24. Testing Human Workflow

### 24.1 Test categories

| Test | Purpose |
|---|---|
| BPMN path test | decision output routes correctly |
| Assignment test | correct assignee/candidate groups produced |
| Authorization test | user can/cannot see/complete task |
| Form contract test | payload accepted/rejected correctly |
| Versioning test | old task/form still works |
| SLA test | timers/escalations trigger correctly |
| Double-submit test | idempotency works |
| Stale task test | invalid completion rejected |
| Audit test | required evidence captured |
| Projection test | inbox shows expected tasks |

### 24.2 Example test matrix

```text
Scenario: High-risk application review
Given application risk is HIGH
When assignment is determined
Then candidate group is senior-reviewer
And due date is within 3 business days
And supervisor escalation timer is scheduled

Scenario: Maker cannot approve own recommendation
Given Alice completed maker task
When Alice attempts checker task completion
Then completion is rejected
And audit event is recorded

Scenario: Missing rejection reason
Given reviewer chooses REJECT
When reasonCode is missing
Then task completion is rejected
And process remains at user task
```

### 24.3 Testing custom UI completion

Do not only test happy path.

Test:

- unauthorized user;
- user not assignee/candidate;
- stale task;
- duplicate submit;
- invalid payload;
- missing reason;
- wrong form version;
- task already completed;
- process canceled;
- Camunda command timeout;
- audit write failure.

---

## 25. Migration Notes from Camunda 7 Human Tasks

### 25.1 Common Camunda 7 assumptions to revisit

| Camunda 7 habit | Camunda 8 rethink |
|---|---|
| Query engine tasks directly from app | Use Tasklist API/custom read model carefully |
| TaskService everywhere | Controlled task API boundary |
| Task listener Java code in engine transaction | Externalized listener/worker/command architecture |
| Relational history queries | Projection/exporter/read model mindset |
| Forms tightly tied to engine app | Versioned forms/task contracts |
| Embedded auth logic | IAM + task + domain authorization split |
| Process engine as app component | Camunda 8 as distributed orchestration platform |

### 25.2 Migration strategy

Inventory:

- user task definitions;
- assignment expressions;
- candidate groups/users;
- task listeners;
- form keys;
- embedded forms;
- TaskService queries;
- custom task inbox;
- delegation/reassignment logic;
- audit requirements;
- authorization assumptions.

Then map to Camunda 8:

```text
TaskService query
  → Tasklist API / custom task projection

Task listener
  → task listener support / worker / domain service / completion wrapper

Form key
  → Camunda form / external form mapping

Candidate group expression
  → variable-driven assignment / assignment service

History task query
  → Operate/exporter/domain audit read model
```

---

## 26. Design Heuristics

### 26.1 Good user task design

A good user task:

1. has clear business purpose;
2. has stable task name;
3. has explicit assignment rule;
4. exposes minimal necessary data;
5. captures structured decision output;
6. has due date/SLA semantics;
7. has escalation path;
8. enforces authorization in backend/domain;
9. has versioned form/payload contract;
10. is observable and auditable;
11. has clear owner team;
12. can survive user absence/reassignment;
13. has tested error paths.

### 26.2 Bad user task design

Warning signs:

```text
- Task name: "Check"
- candidateGroups: "all-users"
- output variable: approved=true/false only
- no due date
- no escalation
- no backend validation
- no audit reason
- form exposes all variables
- completion endpoint trusts browser
- maker can approve own work
- task assigned to individual forever
- no dashboard for stuck tasks
```

---

## 27. Reference Pattern: Regulatory Application Review

### 27.1 Process sketch

```text
Application Submitted
        ↓
Prepare Review Context
        ↓
Officer Review Application  [User Task]
        ↓
Decision Gateway
   ┌────┼─────────────┬───────────────┐
Approve  Request Info  Reject      Escalate
   ↓          ↓          ↓             ↓
Issue     Wait Reply  Notify      Supervisor Review
```

### 27.2 Review task contract

Input:

```json
{
  "reviewContext": {
    "caseId": "CASE-2026-0001",
    "applicationNo": "APP-2026-0001",
    "licenseType": "EA",
    "riskLevel": "MEDIUM",
    "submittedAt": "2026-06-20T09:00:00+07:00",
    "documentRefs": [
      { "documentId": "DOC-1", "type": "APPLICATION_FORM", "version": 2 },
      { "documentId": "DOC-2", "type": "SUPPORTING_DOCUMENT", "version": 1 }
    ],
    "availableDecisions": [
      "APPROVE",
      "REQUEST_MORE_INFORMATION",
      "REJECT",
      "ESCALATE"
    ]
  },
  "assignment": {
    "candidateGroup": "licensing-reviewer",
    "dueAt": "2026-06-24T17:00:00+07:00",
    "priority": 60
  }
}
```

Output:

```json
{
  "reviewResult": {
    "decision": "REQUEST_MORE_INFORMATION",
    "reasonCode": "MISSING_SUPPORTING_DOCUMENT",
    "remarks": "Please submit latest financial statement.",
    "requestedDocumentTypes": ["FINANCIAL_STATEMENT"],
    "reviewedEvidence": [
      { "documentId": "DOC-1", "version": 2 },
      { "documentId": "DOC-2", "version": 1 }
    ],
    "completedBy": "alice",
    "completedAt": "2026-06-21T14:10:00+07:00",
    "taskContractVersion": "application-review-task.v3"
  }
}
```

### 27.3 Review invariants

```text
- Reviewer must belong to licensing-reviewer group.
- Reviewer must be authorized for licenseType and region.
- Decision REJECT requires reasonCode and remarks.
- Decision REQUEST_MORE_INFORMATION requires requestedDocumentTypes.
- Decision APPROVE requires all mandatory document checks passed.
- User cannot complete if task is not active/assigned/claimable.
- Completion must be idempotent.
- Audit must capture reviewed document versions.
```

---

## 28. Operational Runbook for User Task Issues

### 28.1 User cannot see task

Check:

1. process instance at expected user task;
2. task exists in Tasklist/projection;
3. assignee/candidate group values;
4. user group membership;
5. tenant/access configuration;
6. custom UI filters;
7. projection lag;
8. task already claimed by another user;
9. task completed/canceled.

### 28.2 User cannot complete task

Check:

1. task active;
2. user authorized;
3. payload valid;
4. form version;
5. required variables;
6. backend validation result;
7. Camunda API response;
8. process instance incident after completion;
9. duplicate submit/idempotency result.

### 28.3 Task overdue

Check:

1. due date assigned correctly;
2. escalation timer exists;
3. assigned user availability;
4. group has active members;
5. queue dashboard;
6. supervisor intervention;
7. root cause: workload vs hidden bug.

---

## 29. Production Readiness Checklist

Before user task goes to production:

```text
[ ] Task name is business-readable.
[ ] Task purpose is clear.
[ ] Assignment rule is documented.
[ ] Candidate groups/users map to real IAM groups/users.
[ ] Tenant/access boundary is clear.
[ ] Data exposed to form is minimal.
[ ] PII/confidential data is masked or controlled.
[ ] Form payload is versioned.
[ ] Backend validates completion payload.
[ ] Decision taxonomy is structured.
[ ] Reason code is governed.
[ ] Due date/follow-up date is defined if needed.
[ ] Escalation path is modelled if SLA matters.
[ ] Reassignment/return behavior is defined.
[ ] Maker-checker rule is enforced if applicable.
[ ] Double submit is handled.
[ ] Stale UI completion is rejected.
[ ] Completion is audited.
[ ] Evidence/document version references are captured.
[ ] Running old tasks after deployment is considered.
[ ] Tasklist/custom UI choice is justified.
[ ] Support runbook exists.
[ ] Dashboard/alerts exist for stuck/overdue tasks.
```

---

## 30. Key Takeaways

1. User task is a human work contract, not merely a BPMN rectangle.
2. Tasklist is useful, but complex regulatory/case workflows may need custom task/case UI.
3. Assignment must distinguish eligibility, ownership, and completion authority.
4. Candidate group is not a complete authorization model.
5. Form design must be versioned, validated, and auditable.
6. Human decisions should be structured, not just boolean/free text.
7. Due date is metadata; timer event is process behavior.
8. Escalation must be modelled deliberately.
9. Maker-checker and segregation of duties must be enforced outside UI-only logic.
10. Custom task app must use controlled backend API, not raw broad frontend access.
11. Human workflow failure modes are often organizational/security/projection problems, not BPMN syntax problems.
12. For regulatory systems, audit defensibility is a first-class design dimension.

---

## 31. References

Official Camunda documentation and related materials used as grounding for this part:

1. Camunda 8 Docs — User tasks: https://docs.camunda.io/docs/components/modeler/bpmn/user-tasks/
2. Camunda 8 Docs — User task lifecycle: https://docs.camunda.io/docs/apis-tools/frontend-development/task-applications/user-task-lifecycle/
3. Camunda 8 Docs — Tasklist user guide: https://docs.camunda.io/docs/components/tasklist/userguide/using-tasklist/
4. Camunda 8 Docs — Starting processes from Tasklist: https://docs.camunda.io/docs/components/tasklist/userguide/starting-processes/
5. Camunda 8 Docs — Tasklist REST API assign task: https://docs.camunda.io/docs/apis-tools/tasklist-api-rest/specifications/assign-task/
6. Camunda 8 Docs — Identity group management: https://docs.camunda.io/docs/self-managed/components/management-identity/application-user-group-role-management/manage-groups/
7. Camunda Blog — Tasklist user group restrictions: https://camunda.com/blog/2023/12/enhancing-tasklist-security-user-groups-restrictions-user-tasks/
8. Camunda Blog — New features in Camunda 8 for Java developers: https://camunda.com/blog/2024/12/exploring-the-new-features-in-camunda-8-for-java-developers/

---

## 32. Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-014.md
```

Judul berikutnya:

```text
Part 014 — Spring Boot Integration: Camunda Spring Boot Starter, Workers, Configuration, Profiles, and Testing
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-012.md">⬅️ Part 012 — Timers, Deadlines, SLA, Escalation, and Time Semantics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-014.md">Part 014 — Spring Boot Integration: Camunda Spring Boot Starter, Workers, Configuration, Profiles, and Testing ➡️</a>
</div>
