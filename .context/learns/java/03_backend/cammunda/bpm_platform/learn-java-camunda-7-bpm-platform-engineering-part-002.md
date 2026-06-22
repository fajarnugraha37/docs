# learn-java-camunda-7-bpm-platform-engineering-part-002

# Part 002 — BPMN Execution Tree, Token Semantics, Scope, Activity Instance, dan Event Scope

> Seri: **Java Camunda 7 BPM Platform Engineering**  
> Fokus: **Camunda BPM Platform version <= 7**, Java 8 hingga Java 25, dengan perhatian khusus pada runtime internals, correctness, dan operasi produksi.  
> Status seri: **Part 002 dari 035** — seri belum selesai.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya, kita sudah melihat Camunda 7 sebagai engine yang mengeksekusi perintah melalui service API, command executor, command context, persistence session, dan transaction boundary.

Bagian ini masuk ke salah satu mental model paling penting dalam Camunda 7:

> **Satu process instance bukan satu pointer linear. Satu process instance adalah pohon eksekusi yang dapat bercabang, menyimpan scope, memegang variable, menunggu event, dan berubah bentuk sepanjang runtime.**

Kalau mental model ini salah, engineer biasanya akan membuat kesalahan seperti:

- mengira `processInstanceId` selalu sama dengan semua `executionId` aktif;
- mengira satu process instance hanya punya satu active activity;
- salah memasang variable karena tidak memahami variable scope;
- bingung kenapa parallel gateway menghasilkan beberapa execution;
- bingung kenapa `ACT_RU_EXECUTION` berisi execution yang tampak “inactive”;
- salah melakukan message correlation karena memilih execution yang keliru;
- salah membaca Cockpit karena activity instance tree dan execution tree tidak identik;
- salah melakukan process instance modification;
- salah memahami multi-instance body;
- salah menyimpulkan proses “stuck” padahal engine sedang menunggu event atau user task;
- salah membuat query diagnostik karena tidak memahami relasi `PROC_INST_ID_`, `PARENT_ID_`, `ACT_ID_`, `IS_ACTIVE_`, `IS_SCOPE_`, `IS_CONCURRENT_`, dan `IS_EVENT_SCOPE_`.

Target bagian ini bukan sekadar hafal definisi execution, token, dan activity instance. Targetnya adalah memiliki kemampuan membaca runtime Camunda 7 seperti membaca struktur data internal.

Setelah menyelesaikan bagian ini, Anda harus bisa menjawab:

1. Apa beda process instance, execution, activity instance, transition instance, dan token?
2. Kenapa execution tree bisa berbeda dari gambar BPMN?
3. Kenapa activity instance tree lebih dekat ke perspektif business/user daripada execution tree?
4. Kapan execution menjadi scope?
5. Kapan execution menjadi concurrent?
6. Apa yang terjadi di parallel gateway, subprocess, embedded subprocess, event subprocess, boundary event, dan multi-instance?
7. Bagaimana variable scope dipengaruhi oleh execution tree?
8. Bagaimana membaca `ACT_RU_EXECUTION` untuk mendiagnosis process instance?
9. Kenapa process instance modification memakai activity instance sebagai model operasi?
10. Bagaimana menghindari bug production yang berasal dari mental model execution yang salah?

---

## 1. Recap Sangat Singkat dari Part 001

Camunda 7 tidak mengeksekusi process instance dengan cara “menyimpan satu baris process dan satu kolom current_step”.

Ketika API dipanggil, misalnya:

```java
runtimeService.startProcessInstanceByKey("enforcement-case", businessKey, variables);
```

engine akan:

1. membuat command;
2. membuka command context;
3. memuat process definition;
4. membuat runtime execution;
5. mengeksekusi rangkaian atomic operation;
6. bergerak dari node BPMN ke node BPMN berikutnya;
7. berhenti ketika mencapai wait state, async continuation, error boundary, atau titik lain yang menyebabkan state harus disimpan;
8. flush entity ke database;
9. commit atau rollback bersama transaksi.

Pertanyaan besar part ini:

> **Apa bentuk state yang disimpan ketika engine berhenti?**

Jawabannya: terutama execution tree, variable state, task/job/event subscription state, dan metadata runtime lain.

---

## 2. Mental Model Utama: BPMN Diagram Bukan Runtime Data Structure

Diagram BPMN adalah model deklaratif.

Execution tree adalah struktur runtime.

Activity instance tree adalah representasi aktif yang lebih dekat ke “apa yang sedang terjadi menurut BPMN”.

Ketiganya berhubungan, tapi tidak sama.

```text
+-----------------------+
| BPMN Process Model    |
| static definition     |
| deployed once/version |
+-----------+-----------+
            |
            | instantiated
            v
+-----------------------+
| Process Instance      |
| one running case/order|
+-----------+-----------+
            |
            | represented internally as
            v
+-----------------------+
| Execution Tree        |
| internal runtime tree |
| scope + concurrency   |
+-----------+-----------+
            |
            | exposed in user-oriented form as
            v
+-----------------------+
| Activity Instance Tree|
| active BPMN activities|
+-----------------------+
```

A useful simplification:

| Concept | Question it answers |
|---|---|
| BPMN process model | What can happen? |
| Process instance | Which business case is running? |
| Execution tree | How does the engine represent current runtime state? |
| Activity instance tree | Which BPMN activities are currently active? |
| Task/job/event subscription | What is the process waiting for or executing asynchronously? |
| Variable scope | Where does runtime data live? |

Kesalahan umum adalah memperlakukan BPMN diagram sebagai runtime tree. Misalnya, engineer melihat parallel gateway dan berpikir “ada dua token” tetapi tidak memahami bahwa Camunda dapat membuat beberapa execution dengan parent-child relationship yang tidak selalu satu banding satu dengan node BPMN yang terlihat di diagram.

---

## 3. Process Instance

Process instance adalah satu eksekusi dari process definition.

Contoh:

- process definition: `enforcement-case-review:v12`
- process instance: `CASE-2026-000123`

Process definition adalah template. Process instance adalah kasus aktual.

Di Java API:

```java
ProcessInstance pi = runtimeService.startProcessInstanceByKey(
    "enforcement-case-review",
    "CASE-2026-000123",
    Map.of("agency", "CEA", "riskScore", 87)
);
```

Process instance memiliki:

- process instance id;
- process definition id;
- business key;
- tenant id bila multi-tenancy digunakan;
- root execution;
- child executions bila ada concurrency/scope;
- runtime variables;
- tasks/jobs/event subscriptions tergantung posisi proses.

Di Camunda 7, process instance juga merupakan execution. Ini sangat penting.

Artinya, root execution dan process instance sering memiliki id yang sama pada kondisi tertentu, tetapi jangan membangun logika bisnis yang bergantung pada asumsi “semua execution id sama dengan process instance id”. Begitu proses bercabang, masuk subprocess, multi-instance, atau event scope, akan ada child execution.

---

## 4. Execution

Execution adalah unit runtime internal yang digunakan Camunda untuk merepresentasikan:

1. scope;
2. path of execution/concurrency;
3. tempat melekatnya variable lokal;
4. tempat melekatnya task/job/event subscription tertentu;
5. posisi runtime terhadap activity BPMN;
6. parent-child relationship dalam process instance.

Sederhananya:

> **Execution adalah node dalam pohon runtime Camunda.**

Satu process instance memiliki satu root execution dan dapat memiliki banyak child execution.

Contoh struktur sederhana:

```text
ProcessInstance Execution E0
└── active at userTask_review
```

Pada proses linear tanpa concurrency dan tanpa scope tambahan, pohonnya bisa sangat sederhana.

Pada proses paralel:

```text
ProcessInstance Execution E0
└── Concurrent root/scope execution E1
    ├── Execution E2 active at userTask_legalReview
    └── Execution E3 active at userTask_financeReview
```

Pada subprocess:

```text
ProcessInstance Execution E0
└── Scope execution E1 active for embeddedSubProcess_investigation
    └── Execution E2 active at userTask_collectEvidence
```

Pada multi-instance:

```text
ProcessInstance Execution E0
└── Multi-instance body scope E1
    ├── Execution E2 active at userTask_review[0]
    ├── Execution E3 active at userTask_review[1]
    └── Execution E4 active at userTask_review[2]
```

Jangan membaca execution sebagai “thread Java”. Execution bukan OS thread dan bukan Java thread. Execution adalah state representation. Eksekusinya tetap terjadi dalam thread caller atau job executor thread, tergantung transaction/wait-state semantics.

---

## 5. Token Semantics: Istilah Berguna, Tapi Jangan Terlalu Literal

Dalam BPMN, kita sering berbicara tentang token:

- token bergerak dari start event ke activity;
- parallel gateway membagi token;
- join gateway menunggu token;
- token selesai di end event.

Ini berguna untuk memahami BPMN secara konseptual.

Namun, di Camunda 7, implementasi internal tidak sesederhana “satu token = satu row”. Camunda memakai execution tree. Kadang satu token konseptual direpresentasikan oleh satu execution aktif. Kadang engine menciptakan execution tambahan untuk alasan scope, concurrency, event handling, atau optimisasi.

Mental model yang lebih aman:

```text
BPMN token = conceptual control-flow marker
Camunda execution = actual runtime state node used by engine
```

Token membantu menjelaskan behavior BPMN. Execution membantu mendiagnosis Camunda production runtime.

Top 1% engineer harus bisa memakai dua bahasa ini:

- bicara dengan BA/process owner memakai “token/activity/process state”;
- bicara dengan developer/DBA/SRE memakai “execution tree/job/event subscription/runtime table”.

---

## 6. Activity Instance

Activity instance adalah representasi dari instance activity BPMN yang sedang aktif atau pernah aktif dalam konteks runtime tertentu.

Kalau execution tree adalah struktur internal engine, activity instance tree adalah struktur yang lebih dekat ke konsep BPMN aktif.

Camunda memperkenalkan activity instance tree karena execution tree bisa memiliki node tambahan untuk alasan internal seperti scoping dan concurrency. Activity instance tree lebih cocok untuk:

- Cockpit visualization;
- process instance modification;
- memahami active BPMN nodes;
- membedakan internal execution artifact dari activity yang benar-benar relevan bagi operator.

Contoh parallel gateway:

```text
BPMN:

          +--> Legal Review ----+
Start --> |                      | --> Join --> End
          +--> Finance Review --+
```

Execution tree mungkin memiliki inactive parent execution di gateway/fork atau scope tertentu, sedangkan activity instance tree hanya menunjukkan dua activity aktif:

```text
ActivityInstance processInstance
├── Legal Review
└── Finance Review
```

Ini lebih masuk akal bagi operator.

Kalau operator bertanya:

> “Saat ini case ada di mana?”

Jawaban user-facing biasanya memakai activity instance tree, bukan raw execution tree.

Kalau engineer bertanya:

> “Kenapa join gateway optimistic locking?”  
> “Kenapa message correlation ambiguous?”  
> “Kenapa variable tidak kelihatan?”

Jawaban technical biasanya perlu execution tree.

---

## 7. Transition Instance

Transition instance adalah state ketika execution sedang berada dalam transition, bukan sedang menunggu di activity wait state biasa.

Ini lebih terlihat dalam operasi seperti:

- process instance modification;
- async continuation;
- activity cancellation;
- transition between activities;
- debugging instance yang sedang berada di antara activity.

Contoh:

```text
ServiceTask A --sequenceFlow--> UserTask B
```

Dalam kondisi normal, transisi sangat cepat dan tidak terlihat lama. Tetapi dengan async boundary atau modification, engine dapat mengekspos transition instance.

Mental model:

| Instance type | Meaning |
|---|---|
| Activity instance | Engine is inside/at a BPMN activity |
| Transition instance | Engine is between activities or continuing asynchronously |

Untuk kebanyakan business debugging, activity instance cukup. Untuk operation/debugging advanced, transition instance penting.

---

## 8. Scope: Konsep Paling Penting Setelah Execution

Scope adalah batas containment runtime.

Scope menentukan:

- variable visibility;
- lifetime variable lokal;
- event subscription boundary;
- compensation boundary;
- subprocess containment;
- cancellation propagation;
- activity instance hierarchy;
- boundary event attachment;
- error propagation;
- termination behavior.

BPMN element yang sering menjadi scope:

- process instance;
- embedded subprocess;
- event subprocess;
- transaction subprocess;
- call activity boundary secara konseptual di parent-child process;
- multi-instance body;
- activities tertentu yang butuh scope untuk event handling/compensation.

Bukan semua activity adalah scope. Banyak service task/user task biasa bukan scope tambahan.

Mental model:

```text
Scope = kotak runtime yang menampung state anak-anaknya
```

Contoh:

```text
Process Scope
└── Investigation Subprocess Scope
    ├── userTask_collectEvidence
    ├── userTask_reviewEvidence
    └── boundaryTimer_escalateInvestigation
```

Jika subprocess dibatalkan, children dan event subscription di dalamnya ikut terdampak.

Jika variable lokal diset di subprocess scope, variable itu hidup selama subprocess scope hidup.

---

## 9. Variable Scope: Kenapa Variable Kadang “Hilang”

Execution adalah variable scope.

Ini berarti variable dapat hidup di:

- process instance/root execution;
- subprocess scope execution;
- multi-instance body scope;
- child execution;
- task local scope;
- execution local scope.

Contoh:

```java
execution.setVariable("decision", "APPROVE");
```

biasanya menyimpan variable pada scope terdekat yang sesuai atau naik ke parent tergantung API.

Sedangkan:

```java
execution.setVariableLocal("decision", "APPROVE");
```

menyimpan variable pada execution saat ini saja.

Contoh masalah:

```text
Process E0
└── Subprocess E1
    ├── Execution E2 at Legal Review
    └── Execution E3 at Finance Review
```

Jika `setVariableLocal("approved", true)` dipanggil di E2, execution E3 belum tentu melihat variable itu, karena variable lokal melekat di E2.

Jika maksudnya adalah shared process-level decision, simpan di parent/process scope.

Rule of thumb:

| Need | Suggested variable placement |
|---|---|
| Whole case data | Process instance variable |
| Data only inside subprocess | Subprocess local variable |
| Data per multi-instance item | Local variable per MI execution/task |
| Temporary delegate computation | Java local variable, not process variable |
| User input attached to task | Task local variable if not global yet |
| Audit-relevant state | Explicit process variable or business DB record |

Engineering advice:

> Jangan gunakan process variable sebagai global dumping ground, tetapi juga jangan terlalu sering memakai local variable tanpa memahami execution tree.

Variable strategy akan dibahas lebih dalam di Part 008, tapi fondasinya ada di sini: variable visibility mengikuti scope tree, bukan mengikuti intuisi “semua bagian proses bisa melihat semua data”.

---

## 10. Execution Tree vs Activity Instance Tree

Camunda documentation dan blog engineering Camunda menjelaskan bahwa activity instance tree dibuat karena execution tree memiliki dua tanggung jawab internal: scoping dan concurrency. Karena itu, execution tree bisa berisi node yang tidak cocok ditampilkan sebagai “aktivitas aktif” kepada user.

Perbedaan sederhana:

| Aspect | Execution Tree | Activity Instance Tree |
|---|---|---|
| Audience | Engine/developer/SRE | Operator/developer/process repair |
| Purpose | Internal runtime representation | BPMN-aligned active state representation |
| Contains internal nodes? | Yes | Much less |
| Represents scopes? | Yes | Yes, if BPMN-relevant |
| Represents concurrency? | Yes | Yes, as active activities |
| Used for variable/event internals? | Yes | No, not primary |
| Used for process instance modification? | Often via activity instance ids | Yes |

Contoh:

```text
Execution Tree:
E0 process instance / scope
└── E1 inactive concurrent root at parallelGateway_fork
    ├── E2 active at legalReview
    └── E3 active at financeReview

Activity Instance Tree:
AI0 process instance
├── AI1 legalReview
└── AI2 financeReview
```

Kenapa E1 tampak “inactive”? Karena E1 bisa menjadi struktur internal untuk menjaga concurrency/scope, bukan activity yang sedang dikerjakan user.

Ini sangat penting saat membaca `ACT_RU_EXECUTION`.

Jangan langsung menyimpulkan:

> Ada row inactive berarti process stuck.

Belum tentu. Bisa saja itu normal internal structure.

---

## 11. Parallel Gateway: Cara Execution Bercabang

Ambil BPMN:

```text
Start
  |
Parallel Fork
  |--------------------|
  v                    v
Legal Review      Finance Review
  |                    |
  |--------------------|
  v
Parallel Join
  |
End
```

Ketika execution mencapai parallel fork, engine perlu merepresentasikan dua path aktif.

Konseptual token:

```text
Token T splits into T1 and T2
```

Camunda runtime:

```text
Execution E0 process instance/scope
└── E1 concurrent parent/scope/internal
    ├── E2 active at Legal Review
    └── E3 active at Finance Review
```

Setiap branch dapat memiliki:

- current activity id;
- task;
- local variables;
- job if async;
- event subscription if waiting event;
- lifecycle sendiri sampai join.

Pada join, engine harus memastikan semua required paths sudah tiba. Di sinilah optimistic locking bisa terjadi jika multiple threads mencoba menyelesaikan branches secara bersamaan.

Misalnya:

- user A complete Legal Review;
- user B complete Finance Review hampir bersamaan;
- dua transaction mencoba update execution tree/join state;
- salah satu transaction bisa terkena optimistic locking dan perlu retry sesuai konteks.

Ini bukan bug model. Ini konsekuensi concurrency pada relational engine.

Engineering implication:

1. Jangan menganggap parallel branch completion selalu serial.
2. Jangan menjalankan side effect non-idempotent tepat sebelum join tanpa boundary yang aman.
3. Gunakan async boundary dengan hati-hati.
4. Desain delegate/task completion agar retry aman.
5. Untuk high-contention completion, pertimbangkan command retry pattern di application service layer.

---

## 12. Inclusive Gateway dan Complex Join Behavior

Inclusive gateway lebih sulit daripada parallel gateway karena join behavior bergantung pada path yang benar-benar aktif.

Parallel gateway sederhana:

```text
wait for all incoming branches
```

Inclusive gateway:

```text
wait for all incoming branches that were actually activated
```

Masalahnya, engine harus menentukan branch mana yang aktif dan relevan. Ini membuat execution tree dan join analysis lebih rumit.

Production smell:

- inclusive gateway dipakai untuk “conditional parallelism” yang kompleks;
- process punya banyak optional branches;
- join behavior sulit dijelaskan oleh developer maupun BA;
- debugging stuck join menjadi sulit.

Rekomendasi:

- gunakan inclusive gateway hanya jika semua pihak memahami semantics-nya;
- untuk regulatory workflow, sering lebih jelas memakai explicit subprocess atau event-based status aggregation;
- jangan memakai inclusive gateway sebagai pengganti rule engine kompleks;
- tulis test untuk semua kombinasi branch aktif/nonaktif.

---

## 13. Embedded Subprocess: Scope yang Kelihatan

Embedded subprocess menciptakan containment boundary.

BPMN:

```text
Process
└── Investigation Subprocess
    ├── Collect Evidence
    ├── Review Evidence
    └── Complete Investigation
```

Runtime mental model:

```text
Execution E0 process instance
└── Execution E1 scope for Investigation Subprocess
    └── Execution E2 active at Collect Evidence
```

Kenapa perlu scope?

Karena subprocess bisa memiliki:

- local variables;
- boundary events;
- event subprocess;
- compensation handlers;
- child activities;
- lifecycle sendiri;
- cancellation semantics.

Jika subprocess selesai, local state di scope bisa ikut selesai. Jika boundary event membatalkan subprocess, child executions akan dibatalkan sesuai semantics.

Rule:

> Embedded subprocess bukan hanya kotak visual. Ia dapat menjadi runtime scope yang memengaruhi variable, event, cancellation, dan history.

---

## 14. Boundary Event: Event Scope dan Cancellation Semantics

Boundary event melekat pada activity/scope.

Contoh:

```text
[User Task: Review Case]
   attached boundary timer: after 3 days -> Escalate
```

Boundary event bisa interrupting atau non-interrupting.

### 14.1 Interrupting Boundary Event

Jika timer terjadi:

- activity yang ditempeli dibatalkan;
- execution yang menunggu di activity akan dipindah ke boundary path;
- task aktif bisa dihapus/cancel;
- variable/task/history berubah sesuai lifecycle.

Mental model:

```text
Before timer:
E0 process
└── E1 active at Review Case, with timer subscription

After interrupting timer fires:
E0 process
└── E1 active at Escalation Path
```

### 14.2 Non-Interrupting Boundary Event

Jika timer terjadi:

- activity utama tetap berjalan;
- branch baru dibuat untuk escalation path;
- process sekarang punya concurrency.

```text
Before timer:
E0 process
└── E1 active at Review Case, with timer subscription

After non-interrupting timer fires:
E0 process
└── E2 concurrent parent/scope
    ├── E3 still active at Review Case
    └── E4 active at Escalation Path
```

Ini penting untuk SLA/escalation.

Kalau Anda salah memilih interrupting vs non-interrupting boundary event, efeknya besar:

| Boundary type | Effect |
|---|---|
| Interrupting | Original work is cancelled |
| Non-interrupting | Original work continues and new branch starts |

Dalam regulatory workflow:

- reminder biasanya non-interrupting;
- timeout that reassigns/cancels work mungkin interrupting;
- escalation notification sering non-interrupting;
- hard SLA breach path bisa interrupting atau non-interrupting tergantung policy.

---

## 15. Event Subprocess: Scope-Local Event Reaction

Event subprocess adalah subprocess yang dipicu oleh event dalam scope tertentu.

Contoh:

```text
Process Scope
├── Main Flow
└── Event Subprocess: Message "withdrawCase"
```

Jika message diterima, event subprocess dapat:

- interrupting: membatalkan scope utama dan menjalankan event subprocess;
- non-interrupting: menjalankan handler tambahan tanpa membatalkan main flow.

Ini berbeda dari boundary event karena event subprocess berada di dalam scope dan dapat menangkap event yang relevan untuk scope tersebut.

Gunakan event subprocess ketika:

- event dapat terjadi kapan saja selama scope hidup;
- event handling bukan melekat pada satu activity saja;
- event merepresentasikan lifecycle exception seperti withdrawal, cancellation, urgent escalation, legal hold, reopening.

Contoh regulatory case:

```text
Enforcement Case Process
├── Investigation / Review / Approval main flow
└── Event Subprocess: Case Withdrawn
```

Kalau case withdrawn, seluruh case process dapat masuk closure path dengan audit trail yang jelas.

Execution implication:

- event subscription hidup selama scope hidup;
- jika scope selesai, event subscription hilang;
- message correlation harus menemukan subscription yang tepat;
- variable scope menentukan data yang tersedia di handler.

---

## 16. Multi-Instance: Body Scope vs Inner Activity

Multi-instance adalah sumber banyak kebingungan.

BPMN:

```text
Review by each committee member
```

Jika ada 3 reviewer, secara konseptual:

```text
review[0]
review[1]
review[2]
```

Camunda biasanya memakai multi-instance body sebagai scope/container, lalu inner executions untuk setiap instance.

Mental model:

```text
E0 process instance
└── E1 multi-instance body scope
    ├── E2 active at Review Task for reviewer A
    ├── E3 active at Review Task for reviewer B
    └── E4 active at Review Task for reviewer C
```

Variabel penting:

- collection variable;
- element variable;
- loop counter;
- completion condition;
- number of instances;
- number completed;
- number active.

Multi-instance bisa sequential atau parallel.

### 16.1 Sequential Multi-Instance

Satu instance berjalan pada satu waktu.

```text
review A -> review B -> review C
```

Execution tree lebih sederhana, tapi tetap ada MI body semantics.

### 16.2 Parallel Multi-Instance

Semua instance aktif bersamaan.

```text
review A
review B
review C
```

Execution tree bercabang.

Risiko:

- optimistic locking pada completion condition;
- variable overwrite jika semua instance menulis variable global dengan nama sama;
- task query besar;
- notification storm;
- history growth;
- user confusion jika assignment tidak jelas.

Pattern aman:

- gunakan element variable untuk reviewer/item;
- simpan hasil per reviewer dalam struktur yang tidak overwrite;
- atau simpan hasil di business DB dengan unique key `(processInstanceId, reviewerId)`;
- aggregate setelah MI selesai;
- hindari shared mutable process variable di tiap branch kecuali update dilakukan idempotent dan conflict-aware.

---

## 17. Call Activity: Parent Process dan Child Process

Call activity memanggil process definition lain.

BPMN:

```text
Parent Process
└── Call Activity: Investigation Subprocess
        invokes process definition investigation-process
```

Call activity bukan embedded subprocess. Embedded subprocess berada dalam process definition yang sama. Call activity membuat process instance lain.

Mental model:

```text
Parent process instance P1
└── execution waits at callActivity_investigation

Child process instance P2
└── independent execution tree for investigation-process
```

Relasi parent-child ada, tapi child process punya process instance sendiri.

Implication:

- child punya history sendiri;
- child punya variables sendiri;
- variable mapping menentukan input/output;
- version binding penting;
- child process bisa dimigrasikan berbeda dari parent;
- failure semantics harus dirancang;
- parent dapat menunggu child selesai.

Call activity cocok untuk reusable process dengan lifecycle sendiri. Tidak cocok jika hanya ingin grouping visual sederhana.

Decision rule:

| Need | Use |
|---|---|
| Grouping within same process | Embedded subprocess |
| Reusable process definition | Call activity |
| Independent lifecycle/history/versioning | Call activity |
| Shared variable scope tightly coupled | Embedded subprocess |
| Separate ownership/team | Often call activity |

---

## 18. Compensation Scope

Compensation adalah mekanisme BPMN untuk menjalankan undo/compensating action setelah aktivitas tertentu berhasil dilakukan.

Dalam Camunda, compensation membutuhkan scope dan event tracking.

Contoh saga:

```text
Reserve Slot
Charge Fee
Issue License

If later failure:
Compensate Charge Fee
Compensate Reserve Slot
```

Compensation bukan rollback database transaction. Ia adalah business-level correction.

Runtime implication:

- engine perlu tahu activity mana yang completed dan punya compensation handler;
- compensation handlers terikat pada scope;
- jika scope tidak aktif atau sudah selesai sesuai semantics tertentu, compensation availability berubah;
- execution/event state harus cukup untuk menjalankan handler.

Production warning:

> Jangan menjual compensation ke business sebagai “rollback otomatis”. Compensation adalah workflow eksplisit yang bisa gagal dan perlu observability/retry sendiri.

---

## 19. Event Subscription dan Execution

Message catch, signal catch, conditional event, compensation, dan timer sering menghasilkan runtime subscription/job.

Contoh message catch:

```text
Intermediate Catch Event: wait for "paymentReceived"
```

Runtime:

```text
Execution E1 active/waiting at message catch event
EventSubscription S1
  eventName = paymentReceived
  executionId = E1
  processInstanceId = P1
```

Ketika API dipanggil:

```java
runtimeService
    .createMessageCorrelation("paymentReceived")
    .processInstanceBusinessKey("CASE-123")
    .correlate();
```

engine mencari event subscription yang cocok.

Jika ada nol hasil:

- message datang terlalu cepat;
- process belum sampai catch event;
- salah business key/correlation key;
- subscription sudah hilang karena scope selesai/cancelled.

Jika ada lebih dari satu hasil:

- correlation ambiguous;
- business key tidak cukup spesifik;
- process punya beberapa subscription dengan event name sama;
- multi-instance/parallel flow menghasilkan banyak waiting execution.

Execution tree membantu memahami kenapa subscription ada lebih dari satu.

Pattern aman:

1. Gunakan business key yang stabil.
2. Tambahkan correlation variable yang spesifik.
3. Hindari event name generik tanpa discriminator.
4. Tangani early message dengan inbox/outbox pattern jika event bisa datang sebelum subscription dibuat.
5. Jangan mengandalkan timing antar sistem.

---

## 20. Wait State dan Execution Position

Wait state adalah titik engine berhenti dan menyimpan state.

Contoh wait state:

- user task;
- receive task;
- intermediate catch event;
- message catch event;
- timer event;
- signal catch event;
- external task;
- async continuation job;
- call activity waiting child process;
- event-based gateway waiting event.

Saat berada di wait state, execution tree menjadi persistent dan dapat diobservasi.

Contoh user task:

```text
ACT_RU_EXECUTION
  E1 active at userTask_review

ACT_RU_TASK
  T1 executionId = E1
```

Contoh timer:

```text
ACT_RU_EXECUTION
  E1 active at timerCatchEvent_wait3Days

ACT_RU_JOB
  J1 executionId = E1, dueDate = +3 days
```

Contoh message catch:

```text
ACT_RU_EXECUTION
  E1 active at messageCatch_paymentReceived

ACT_RU_EVENT_SUBSCR
  S1 executionId = E1, eventName = paymentReceived
```

Jadi ketika mendiagnosis process instance, jangan hanya lihat execution. Lihat juga task/job/event subscription.

---

## 21. ACT_RU_EXECUTION: Cara Membaca Runtime Tree

`ACT_RU_EXECUTION` adalah tabel runtime utama untuk execution.

Kolom dapat berbeda antar versi/database, tetapi konsep penting yang sering muncul:

| Column | Meaning |
|---|---|
| `ID_` | execution id |
| `REV_` | revision for optimistic locking |
| `ROOT_PROC_INST_ID_` | root process instance id, terutama berguna pada hierarchy |
| `PROC_INST_ID_` | process instance id |
| `BUSINESS_KEY_` | business key pada process instance/root |
| `PARENT_ID_` | parent execution id |
| `PROC_DEF_ID_` | process definition id |
| `SUPER_EXEC_` | execution di parent process yang memanggil child process via call activity |
| `SUPER_CASE_EXEC_` | relation to CMMN case execution if used |
| `CASE_INST_ID_` | CMMN related if used |
| `ACT_ID_` | current activity id, bila execution berada pada activity tertentu |
| `IS_ACTIVE_` | whether execution is active |
| `IS_CONCURRENT_` | whether execution is concurrent path |
| `IS_SCOPE_` | whether execution represents scope |
| `IS_EVENT_SCOPE_` | whether execution is event scope |
| `SUSPENSION_STATE_` | active/suspended state |
| `TENANT_ID_` | tenant id |

Prinsip membaca:

1. Mulai dari `PROC_INST_ID_`.
2. Ambil semua row dengan process instance id tersebut.
3. Susun berdasarkan `PARENT_ID_`.
4. Identifikasi root execution.
5. Tandai scope execution.
6. Tandai concurrent execution.
7. Tandai active activity via `ACT_ID_`.
8. Join ke task/job/event subscription untuk memahami wait state.

Contoh SQL diagnostik dasar:

```sql
SELECT
    ID_,
    PARENT_ID_,
    PROC_INST_ID_,
    ACT_ID_,
    IS_ACTIVE_,
    IS_SCOPE_,
    IS_CONCURRENT_,
    IS_EVENT_SCOPE_,
    SUSPENSION_STATE_,
    REV_
FROM ACT_RU_EXECUTION
WHERE PROC_INST_ID_ = :processInstanceId
ORDER BY PARENT_ID_, ID_;
```

Untuk user task:

```sql
SELECT
    t.ID_              AS TASK_ID,
    t.EXECUTION_ID_    AS EXECUTION_ID,
    t.PROC_INST_ID_    AS PROC_INST_ID,
    t.TASK_DEF_KEY_    AS TASK_DEF_KEY,
    t.NAME_            AS TASK_NAME,
    t.ASSIGNEE_,
    t.CREATE_TIME_,
    t.DUE_DATE_
FROM ACT_RU_TASK t
WHERE t.PROC_INST_ID_ = :processInstanceId
ORDER BY t.CREATE_TIME_;
```

Untuk jobs:

```sql
SELECT
    j.ID_           AS JOB_ID,
    j.EXECUTION_ID_,
    j.PROCESS_INSTANCE_ID_,
    j.PROCESS_DEF_ID_,
    j.RETRIES_,
    j.DUEDATE_,
    j.LOCK_OWNER_,
    j.LOCK_EXP_TIME_,
    j.EXCEPTION_MSG_
FROM ACT_RU_JOB j
WHERE j.PROCESS_INSTANCE_ID_ = :processInstanceId
ORDER BY j.DUEDATE_;
```

Untuk event subscriptions:

```sql
SELECT
    s.ID_,
    s.EVENT_TYPE_,
    s.EVENT_NAME_,
    s.EXECUTION_ID_,
    s.PROC_INST_ID_,
    s.ACTIVITY_ID_,
    s.CREATED_
FROM ACT_RU_EVENT_SUBSCR s
WHERE s.PROC_INST_ID_ = :processInstanceId
ORDER BY s.CREATED_;
```

Catatan penting:

> Query manual boleh untuk diagnosis. Mutation manual ke runtime tables sangat berisiko dan pada umumnya harus dihindari. Gunakan API engine untuk modification, migration, retry, cancellation, dan recovery.

---

## 22. Membaca Execution Tree dari SQL: Contoh Praktis

Misalkan hasil query:

```text
ID_   PARENT_ID_  ACT_ID_                 ACTIVE  SCOPE  CONCURRENT
E0    null        null                    1       1      0
E1    E0          parallelGateway_fork    0       0      1
E2    E1          legalReview             1       0      1
E3    E1          financeReview           1       0      1
```

Interpretasi:

```text
E0 process root/scope
└── E1 internal concurrent parent, not active user-facing activity
    ├── E2 active at legalReview
    └── E3 active at financeReview
```

Jika Anda hanya melihat `E1` dan bingung kenapa `ACT_ID_ = parallelGateway_fork` tapi inactive, itu normal. Gateway fork sudah dilewati secara business perspective, tetapi execution internal masih ada untuk representasi concurrency.

Sekarang join task:

```text
ACT_RU_TASK:
TASK_ID T100, EXECUTION_ID E2, TASK_DEF_KEY legalReview
TASK_ID T101, EXECUTION_ID E3, TASK_DEF_KEY financeReview
```

Artinya ada dua user tasks aktif.

Jika `legalReview` complete:

```text
ID_   PARENT_ID_  ACT_ID_                 ACTIVE  SCOPE  CONCURRENT
E0    null        null                    1       1      0
E1    E0          parallelGateway_fork    0       0      1
E3    E1          financeReview           1       0      1
```

Engine bisa juga melakukan compaction. Struktur aktual dapat berubah karena engine mengoptimalkan execution tree. Inilah sebabnya tidak aman menyimpan asumsi rigid terhadap execution id child tertentu dalam business table kecuali memang diperlukan dan dikontrol.

---

## 23. Execution Tree Compaction

Camunda dapat mengoptimalkan execution tree pada runtime.

Artinya, struktur execution tidak selalu stabil sepanjang lifetime process instance.

Contoh:

- parallel branch selesai;
- satu branch tersisa;
- engine dapat prune/compact execution;
- task/variable references dapat dipindahkan ke execution lain;
- activity instance tree tetap lebih stabil secara BPMN perspective.

Engineering implication:

1. Jangan menyimpan `executionId` sebagai long-term business reference kecuali sangat sadar risikonya.
2. Untuk business identity, gunakan business key atau domain id.
3. Untuk task operation, gunakan task id saat task aktif.
4. Untuk message correlation, gunakan business key/correlation variable, bukan execution id kecuali event sangat spesifik dan short-lived.
5. Untuk process repair, gunakan activity instance tree/API.

---

## 24. Process Instance Modification dan Activity Instance

Process instance modification memungkinkan operator/developer melakukan operasi seperti:

- cancel activity instance;
- start before activity;
- start after activity;
- start transition;
- repair process stuck/wrong path;
- move instance dari satu activity ke activity lain;
- mass modification via batch.

Modification API lebih BPMN/activity-oriented, bukan raw execution-oriented.

Contoh Java:

```java
runtimeService
    .createProcessInstanceModification(processInstanceId)
    .cancelAllForActivity("reviewCase")
    .startBeforeActivity("reworkCase")
    .execute();
```

Contoh retrieving activity instance:

```java
ActivityInstance tree = runtimeService.getActivityInstance(processInstanceId);
```

Kenapa ini penting?

Karena operator biasanya tidak ingin berkata:

> cancel execution E3 and create execution E9

Operator ingin berkata:

> pindahkan case dari Review Case ke Rework Case

Activity instance tree menyediakan bahasa yang lebih dekat ke BPMN.

Tetapi advanced engineer tetap harus paham execution tree karena modification bisa berdampak pada:

- variable scope;
- event subscriptions;
- active tasks;
- jobs;
- compensation;
- history;
- concurrency;
- call activity child instances;
- multi-instance body.

Process instance modification bukan magic. Ia adalah surgery terhadap runtime state.

Production rule:

> Modification harus diperlakukan seperti administrative operation dengan audit, approval, dry-run thinking, dan rollback/compensation plan.

---

## 25. Scope and Cancellation Propagation

Ketika scope dibatalkan, children di dalam scope ikut terdampak.

Contoh embedded subprocess dengan dua active tasks:

```text
Process E0
└── Investigation Subprocess Scope E1
    ├── E2 active at collectEvidence
    └── E3 active at interviewWitness
```

Jika subprocess dibatalkan oleh interrupting boundary event:

- E2 dibatalkan;
- E3 dibatalkan;
- tasks terkait dihapus/cancelled;
- jobs/event subscriptions di dalam scope dibersihkan;
- history mencatat lifecycle sesuai konfigurasi history level;
- boundary path dimulai.

Kalau boundary event non-interrupting, E1 tetap hidup dan branch baru muncul.

Cancellation propagation adalah alasan scope sangat penting.

Anti-pattern:

- menaruh timer boundary interrupting pada subprocess besar tanpa memahami semua child tasks akan dibatalkan;
- memakai terminate end event di subprocess tanpa memahami scope termination;
- melakukan modification cancel activity pada MI body dan terkejut semua instances hilang.

---

## 26. Event Scope: Untuk Event yang Harus Hidup Bersama Scope

`IS_EVENT_SCOPE_` di execution menunjukkan execution yang berhubungan dengan event scope.

Event scope digunakan engine untuk menangani event semantics tertentu, misalnya compensation dan boundary/event handling.

Anda tidak perlu menghafal semua internal detail untuk menggunakan Camunda, tetapi untuk troubleshooting production, Anda harus tahu:

- event-related execution dapat muncul di runtime table;
- tidak semua execution aktif merepresentasikan task/activity user-facing;
- event scope dapat memengaruhi cancellation dan compensation;
- manual deletion/mutation terhadap execution event scope dapat merusak consistency.

Rule:

> Bila melihat `IS_EVENT_SCOPE_ = 1`, jangan anggap row itu noise. Ia bisa memegang semantics penting untuk event/compensation lifecycle.

---

## 27. Execution vs Task

User task bukan execution.

User task adalah runtime entity yang melekat ke execution.

```text
Execution E1 active at userTask_review
└── Task T1 assigned to fajar
```

Tabel:

```text
ACT_RU_EXECUTION.ID_ = E1
ACT_RU_TASK.EXECUTION_ID_ = E1
```

Satu execution biasanya punya satu active user task untuk activity tersebut, tetapi dalam struktur kompleks, jangan membuat asumsi terlalu luas.

Task lifecycle:

- created;
- assigned/claimed;
- completed;
- deleted/cancelled;
- historically recorded.

Execution lifecycle:

- enters activity;
- creates task;
- waits;
- task completed;
- execution leaves activity;
- moves onward.

Jadi saat user complete task, yang terjadi bukan hanya `ACT_RU_TASK` delete. Engine melanjutkan execution dari activity tersebut.

---

## 28. Execution vs Job

Job juga bukan execution.

Job adalah unit work asynchronous yang melekat ke execution atau process definition/timer context.

Contoh async service task:

```text
Execution E1 waiting before serviceTask_sendEmail
Job J1 created for async continuation
```

Ketika job executor mengambil job:

1. job dilock;
2. job dieksekusi;
3. command context dibuka;
4. execution dilanjutkan;
5. jika sukses, job dihapus;
6. jika gagal, retry dikurangi atau incident dibuat.

Execution menyimpan posisi state. Job menyimpan pending asynchronous work.

```text
Execution = where the process is
Job       = what engine must execute later
```

---

## 29. Execution vs Event Subscription

Event subscription adalah “waiting registration”.

Contoh receive message:

```text
Execution E1 active at waitForPayment
EventSubscription S1 eventName=paymentReceived executionId=E1
```

Jika message datang, subscription ditemukan dan execution dilanjutkan.

```text
EventSubscription = what event can wake this execution
```

Jangan mencari message catch hanya di `ACT_RU_EXECUTION`. Lihat `ACT_RU_EVENT_SUBSCR`.

---

## 30. Execution vs Incident

Incident muncul ketika engine tidak bisa melanjutkan execution/job secara normal, misalnya failed job retries habis.

Incident biasanya terkait dengan:

- failed job;
- external task failure;
- custom incident handler;
- process definition/runtime context.

```text
Execution E1 at async service task
Job J1 failed, retries = 0
Incident I1 points to failed job/execution/process instance
```

Incident bukan state BPMN utama, tetapi operational state yang memberi tahu operator bahwa perlu intervensi.

Execution tree menjawab “di mana prosesnya”. Incident menjawab “apa yang gagal sehingga proses tidak lanjut”.

---

## 31. Common Production Misreadings

### 31.1 “Process instance punya lebih dari satu execution, berarti duplicate.”

Tidak. Itu normal untuk concurrency/scope.

### 31.2 “Ada inactive execution, berarti stuck.”

Belum tentu. Bisa internal parent untuk parallel execution.

### 31.3 “Task hilang berarti proses selesai.”

Belum tentu. Bisa pindah ke job, event wait, timer, external task, atau subprocess.

### 31.4 “Message correlation gagal karena Camunda error.”

Belum tentu. Bisa message datang sebelum subscription, salah key, subscription sudah cancelled, atau ambiguous.

### 31.5 “Variable tidak ada berarti tidak diset.”

Belum tentu. Bisa ada di local scope lain.

### 31.6 “Execution id aman disimpan sebagai business reference.”

Tidak selalu. Execution tree bisa berubah/compact.

### 31.7 “Parallel MI bisa update variable global tanpa konflik.”

Berbahaya. Bisa overwrite, race, optimistic locking, atau inconsistent aggregation.

---

## 32. Diagnostic Playbook: Process Instance “Stuck”

Jika ada laporan:

> Case tidak bergerak.

Jangan langsung restart engine atau update DB manual.

Lakukan langkah sistematis:

### Step 1 — Confirm process instance exists

```sql
SELECT ID_, PROC_DEF_ID_, BUSINESS_KEY_, SUSPENSION_STATE_
FROM ACT_RU_EXECUTION
WHERE PROC_INST_ID_ = :processInstanceId
  AND PARENT_ID_ IS NULL;
```

Jika tidak ada runtime row, mungkin instance sudah selesai/cancelled. Cek history.

### Step 2 — Read execution tree

```sql
SELECT ID_, PARENT_ID_, ACT_ID_, IS_ACTIVE_, IS_SCOPE_, IS_CONCURRENT_, IS_EVENT_SCOPE_
FROM ACT_RU_EXECUTION
WHERE PROC_INST_ID_ = :processInstanceId
ORDER BY PARENT_ID_, ID_;
```

Tentukan active activities.

### Step 3 — Check active user tasks

```sql
SELECT ID_, TASK_DEF_KEY_, NAME_, ASSIGNEE_, CREATE_TIME_, DUE_DATE_
FROM ACT_RU_TASK
WHERE PROC_INST_ID_ = :processInstanceId;
```

Jika ada task, proses memang menunggu user.

### Step 4 — Check jobs

```sql
SELECT ID_, EXECUTION_ID_, RETRIES_, DUEDATE_, LOCK_OWNER_, LOCK_EXP_TIME_, EXCEPTION_MSG_
FROM ACT_RU_JOB
WHERE PROCESS_INSTANCE_ID_ = :processInstanceId;
```

Jika retries 0, cek incident.

### Step 5 — Check event subscriptions

```sql
SELECT ID_, EVENT_TYPE_, EVENT_NAME_, EXECUTION_ID_, ACTIVITY_ID_, CREATED_
FROM ACT_RU_EVENT_SUBSCR
WHERE PROC_INST_ID_ = :processInstanceId;
```

Jika ada subscription, proses menunggu event.

### Step 6 — Check external tasks

```sql
SELECT ID_, TOPIC_NAME_, WORKER_ID_, LOCK_EXP_TIME_, RETRIES_, ERROR_MSG_
FROM ACT_RU_EXT_TASK
WHERE PROC_INST_ID_ = :processInstanceId;
```

Jika external task locked lama atau retries 0, masalah ada di worker/failure handling.

### Step 7 — Check incidents

```sql
SELECT ID_, INCIDENT_TYPE_, EXECUTION_ID_, ACTIVITY_ID_, CAUSE_INCIDENT_ID_, CONFIGURATION_, INCIDENT_MSG_
FROM ACT_RU_INCIDENT
WHERE PROC_INST_ID_ = :processInstanceId;
```

Incident mengarah ke operational failure.

### Step 8 — Use engine API/Cockpit for repair

Gunakan:

- retry job;
- set job retries;
- correlate message;
- complete task;
- unlock/retry external task;
- process instance modification;
- migration jika definisi bermasalah;
- cancellation jika business decided.

Jangan update runtime table manual kecuali benar-benar break-glass dengan full backup, vendor-level knowledge, dan acceptance risk.

---

## 33. Modelling Implications untuk Regulatory Case Management

Dalam sistem enforcement/regulatory, process instance sering merepresentasikan case.

Case bukan hanya flow linear. Biasanya ada:

- intake;
- triage;
- assignment;
- investigation;
- evidence collection;
- parallel review;
- legal review;
- approval;
- correspondence;
- appeal;
- reopening;
- escalation;
- SLA timer;
- supervisor override;
- withdrawal/cancellation;
- audit and retention.

Camunda execution tree cocok untuk durable state, tetapi model harus disiplin.

### 33.1 Jangan model semua sebagai satu mega-process linear

Mega-process membuat execution tree sulit dibaca.

Lebih baik pisahkan:

- parent case lifecycle;
- investigation subprocess;
- enforcement action subprocess;
- appeal subprocess;
- notification/correspondence subprocess.

Gunakan embedded subprocess untuk containment yang tight. Gunakan call activity untuk reusable/independent lifecycle.

### 33.2 Gunakan scopes untuk lifecycle boundary yang meaningful

Contoh:

```text
Case Process
├── Intake Scope
├── Investigation Scope
├── Decision Scope
├── Appeal Scope
└── Closure Scope
```

Setiap scope dapat memiliki local variables, timers, event subprocess, dan audit semantics.

### 33.3 Escalation harus jelas interrupting atau non-interrupting

Reminder:

```text
non-interrupting timer -> send reminder/escalate visibility
```

Hard timeout:

```text
interrupting timer -> reassign/cancel current task and move to supervisor review
```

Jangan mencampur keduanya.

### 33.4 Jangan simpan domain truth hanya di process variables

Camunda variables bagus untuk process routing/state. Tetapi regulatory system biasanya butuh domain database sebagai system of record.

Pattern:

```text
Business DB = authoritative case/evidence/decision data
Camunda = lifecycle orchestration and work coordination
Process variables = routing snapshot / correlation / small state
History = process audit trail, not full domain archive
```

---

## 34. Java 8 hingga Java 25: Apa Relevansinya pada Execution Model?

Execution model Camunda 7 tidak berubah hanya karena Java version berubah. Tetapi cara kita menulis code sekitar execution sangat dipengaruhi Java version.

### 34.1 Java 8 Legacy Reality

Banyak Camunda 7 estate lama berjalan di Java 8.

Konsekuensi:

- API style lebih banyak memakai `Map`, POJO, dan imperative code;
- record/sealed class belum ada;
- date/time harus disiplin memakai `java.time`, bukan `Date` sembarangan;
- dependency version sering tua;
- serialization compatibility lebih rawan.

### 34.2 Java 11/17 Modernization

Java 11/17 memberi baseline lebih baik:

- better GC;
- better container awareness;
- better HTTP client if needed;
- language improvements;
- stronger TLS/security defaults;
- better observability ecosystem.

Tetapi Camunda 7 compatibility harus dicek per versi Camunda dan distro.

### 34.3 Java 21 dan Virtual Threads

Virtual threads tidak otomatis membuat Camunda execution menjadi lightweight actor.

Camunda 7 tetap relational DB-backed engine dengan transaction semantics. Virtual threads bisa berguna di aplikasi sekitar engine, tetapi tidak mengubah:

- DB contention;
- optimistic locking;
- job acquisition;
- wait state persistence;
- variable serialization;
- transaction boundary.

Jangan menyelesaikan execution tree/concurrency problem dengan sekadar menambah thread.

### 34.4 Java 25 Planning

Untuk Java 25, perlakukan sebagai future compatibility planning, bukan asumsi bahwa semua Camunda 7 runtime lama langsung cocok.

Checklist:

- Camunda 7 version support;
- Spring Boot version;
- application server compatibility;
- JDBC driver;
- database dialect;
- bytecode target;
- dependency illegal reflective access;
- serialization compatibility;
- CI test matrix.

---

## 35. Design Rules yang Harus Dipegang

### Rule 1 — Business identity bukan execution id

Gunakan business key/domain id untuk business identity.

### Rule 2 — Execution tree adalah runtime implementation detail yang perlu dipahami, bukan API domain utama

Pahami untuk debugging, tetapi jangan bocorkan ke domain model kecuali perlu.

### Rule 3 — Scope harus intentional

Subprocess, event subprocess, boundary event, dan MI body bukan hanya layout diagram.

### Rule 4 — Variable placement harus eksplisit

Global process variable, local variable, task local variable, dan domain DB punya fungsi berbeda.

### Rule 5 — Parallelism berarti conflict potential

Parallel gateway dan parallel MI meningkatkan risiko race, overwrite, optimistic locking, dan ambiguous correlation.

### Rule 6 — Event correlation harus didesain, bukan diasumsikan

Message name saja jarang cukup. Gunakan business key dan correlation key yang stabil.

### Rule 7 — Process repair adalah surgery

Process instance modification harus diaudit dan diuji.

### Rule 8 — Activity instance tree untuk operator, execution tree untuk engine diagnostics

Jangan salah audience.

---

## 36. Mini Lab: Membayangkan Execution Tree dari BPMN

### Scenario

Case enforcement memiliki flow:

1. Start case.
2. User task: Initial Assessment.
3. Parallel gateway:
   - Legal Review user task.
   - Finance Review user task.
4. Join.
5. Embedded subprocess: Final Decision.
   - User task: Draft Decision.
   - Boundary timer non-interrupting: Reminder after 3 days.
6. End.

### Pertanyaan

1. Setelah Initial Assessment dibuat, ada berapa active user task?
2. Setelah parallel fork, ada berapa active branches?
3. Apakah parent execution di fork mungkin inactive?
4. Jika Legal Review selesai lebih dulu, apakah process selesai dari parallel section?
5. Setelah masuk Final Decision subprocess, apakah ada scope baru?
6. Jika timer reminder non-interrupting fired, apakah Draft Decision dibatalkan?
7. Apa yang terjadi pada execution tree setelah timer fired?
8. Variable `legalApproved` sebaiknya process variable atau local variable?
9. Reminder sent flag sebaiknya disimpan di mana?
10. Kalau operator ingin pindahkan Draft Decision ke Rework, API apa yang lebih tepat daripada update DB?

### Jawaban Ringkas

1. Satu.
2. Dua.
3. Ya, bisa.
4. Tidak, join menunggu branch lain.
5. Ya, embedded subprocess dapat menjadi scope.
6. Tidak, karena timer non-interrupting.
7. Ada branch tambahan untuk reminder/escalation path sementara Draft Decision tetap aktif.
8. Jika dipakai untuk final decision aggregation, simpan di process/subprocess scope yang tepat, bukan local branch yang hilang.
9. Jika audit/business relevant, simpan di domain DB atau process variable eksplisit; jika temporary, local variable cukup.
10. Gunakan process instance modification API/Cockpit, bukan update manual runtime table.

---

## 37. Checklist Pemahaman

Anda sudah memahami part ini jika bisa menjelaskan tanpa melihat catatan:

- process instance adalah execution root;
- execution tree dapat berbeda dari BPMN diagram;
- activity instance tree lebih dekat ke active BPMN activities;
- execution dapat menjadi scope, concurrent path, atau event scope;
- variable visibility mengikuti scope;
- user task/job/event subscription melekat ke execution tetapi bukan execution itu sendiri;
- parallel gateway membuat concurrency yang dapat menyebabkan optimistic locking;
- non-interrupting boundary event membuat branch tambahan;
- interrupting boundary event membatalkan activity/scope yang ditempeli;
- multi-instance punya body scope dan inner instances;
- call activity membuat child process instance;
- `ACT_RU_EXECUTION` harus dibaca sebagai tree, bukan flat rows;
- process instance modification harus memakai API, bukan SQL manual;
- business key lebih stabil daripada execution id.

---

## 38. Ringkasan Part 002

Bagian ini membangun fondasi runtime Camunda 7 yang sangat penting.

Intinya:

> Camunda 7 menyimpan proses berjalan sebagai execution tree. BPMN token adalah konsep modelling, execution adalah representasi runtime, dan activity instance tree adalah tampilan BPMN-oriented atas state aktif.

Pemahaman ini memengaruhi hampir semua hal:

- transaction boundary;
- async continuation;
- job executor;
- message correlation;
- variable scoping;
- user task routing;
- timer/escalation;
- subprocess cancellation;
- multi-instance aggregation;
- process modification;
- production troubleshooting;
- performance;
- auditability;
- migration.

Tanpa memahami execution tree, engineer hanya bisa memakai Camunda sebagai black box. Dengan memahami execution tree, engineer bisa membaca Camunda sebagai durable state machine runtime.

---

## 39. Referensi

Referensi utama untuk bagian ini:

1. Camunda 7 Manual — Process Engine Concepts.  
   `https://docs.camunda.org/manual/latest/user-guide/process-engine/process-engine-concepts/`

2. Camunda 7 Manual — Process Instance Modification.  
   `https://docs.camunda.org/manual/latest/user-guide/process-engine/process-instance-modification/`

3. Camunda 7 REST API — Get Activity Instance Tree / Process Instance APIs.  
   `https://docs.camunda.org/rest/camunda-bpm-platform/7.24/`

4. Camunda Blog — Introducing an Activity Instance Model to the core Process Engine.  
   `https://camunda.com/blog/2013/06/introducing-activity-instance-model-to/`

5. Camunda Blog — Why we Re-Implemented BPMN Multi-Instance Support in 7.3.  
   `https://camunda.com/blog/2015/06/why-we-re-implemented-bpmn-multi/`

6. Camunda 7 Javadocs — `RuntimeService`, `ActivityInstance`, `Execution`, `ProcessInstance`.  
   `https://docs.camunda.org/javadoc/camunda-bpm-platform/7.24/`

7. Camunda 7 Manual — Transactions in Processes.  
   `https://docs.camunda.org/manual/7.24/user-guide/process-engine/transactions-in-processes/`

---

## 40. Status Seri

Part ini selesai.

Status seri: **belum selesai**.

Lanjut ke part berikutnya:

```text
learn-java-camunda-7-bpm-platform-engineering-part-003.md
```

Topik berikutnya:

```text
Transaction Boundaries, Wait States, Atomic Operations, dan Consistency Model
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-001.md">⬅️ Part 001 — Camunda 7 Architecture Deep Dive: Engine, Runtime, Services, Command Context</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-003.md">Transaction Boundaries, Wait States, Atomic Operations, dan Consistency Model ➡️</a>
</div>
