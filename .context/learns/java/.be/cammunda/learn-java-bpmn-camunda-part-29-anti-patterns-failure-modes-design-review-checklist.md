# learn-java-bpmn-camunda-process-orchestration-engineering

## Part 29 — Anti-patterns, Failure Modes, and Design Review Checklist

> Seri: Advanced Java BPMN, Camunda, and Process Orchestration Engineering  
> Target: Java 8–25, Camunda 7, Camunda 8, BPMN 2.0, regulatory/case-management-grade workflow systems  
> Fokus: mengenali desain workflow yang kelihatan benar di diagram tetapi rapuh di production, lalu mengubahnya menjadi checklist review yang bisa dipakai sebelum build, sebelum UAT, sebelum production, dan saat incident.

---

## 0. Tujuan Part Ini

Part sebelumnya sudah membahas BPMN semantics, Camunda 7/8, Zeebe, Java worker, idempotency, process variables, human workflow, DMN, message correlation, timers, parallelism, subprocess, saga, testing, observability, operation, security, integration, performance, versioning, dan regulatory modeling.

Bagian ini menyatukan semua itu menjadi satu kemampuan yang lebih senior: **melihat risiko sebelum risiko itu menjadi incident**.

Engineer pemula sering bertanya:

> “Apakah BPMN ini valid?”

Engineer menengah bertanya:

> “Apakah BPMN ini bisa jalan di Camunda?”

Engineer senior bertanya:

> “Apakah process ini tetap benar ketika external system timeout, user double-click, message datang lebih awal, worker crash setelah side effect sukses, process version berubah saat instance lama masih berjalan, operator perlu repair incident, auditor bertanya dua tahun kemudian, dan traffic naik 10x?”

Part ini membantu berpikir seperti kategori ketiga.

---

## 1. Mental Model Utama: Anti-pattern Adalah Pelanggaran Boundary

Hampir semua anti-pattern workflow berasal dari boundary yang salah.

Boundary yang sering dilanggar:

| Boundary | Kalau Dilanggar | Gejala |
|---|---|---|
| BPMN vs domain model | process variable jadi database | data inconsistency, audit kabur |
| BPMN vs application code | logic terlalu banyak di diagram | diagram sulit diuji, logic tersebar |
| domain service vs worker | worker jadi god service | sulit retry, sulit mock, sulit ownership |
| business failure vs technical failure | semua error jadi retry/incident | incident noise atau business flow berhenti |
| process state vs entity state | status domain ikut token BPMN mentah | UI salah, reporting salah |
| human decision vs system action | task completed tanpa authorisation domain | fraud risk, audit gap |
| integration boundary | external side effect tidak idempotent | duplicate payment/email/document |
| version boundary | model baru merusak instance lama | migration chaos |
| observability boundary | technical logs tanpa business context | incident sulit diinvestigasi |
| operation boundary | repair langsung di DB | audit rusak, state engine corrupt |

Cara membaca anti-pattern:

```text
Anti-pattern = boundary violation + hidden assumption + failure mode yang belum dimodelkan.
```

Contoh:

```text
"Service task calls payment API directly and retries three times."

Hidden assumptions:
- Payment API failure always means payment failed.
- Retry is always safe.
- Worker will not crash after payment succeeded.
- Duplicate payment is impossible.
- Process variable contains enough info to reconcile.
- Operator knows what to do if incident occurs.

Failure mode:
- Payment succeeded but complete job failed.
- Job retried.
- Payment charged twice.
- Process shows one payment.
- Finance shows two payments.
- Audit cannot explain correction.
```

Top 1% engineer tidak hanya melihat `serviceTask`. Ia melihat ambiguity window, side effect boundary, idempotency key, reconciliation event, compensation path, audit requirement, dan repair runbook.

---

## 2. Anti-pattern #1 — BPMN Dipakai sebagai “God Orchestrator”

### 2.1 Gejala

Process model berisi terlalu banyak hal:

- business lifecycle;
- UI step;
- backend validation;
- integration detail;
- retry detail;
- database update detail;
- email template selection;
- role authorization;
- SLA calculation;
- document generation branching;
- exception handling untuk semua kemungkinan kecil.

Diagram menjadi sangat besar. Semua orang takut mengubahnya. Saat ada bug kecil, developer harus membuka diagram monster.

### 2.2 Kenapa Ini Terjadi

Biasanya karena tim mengira:

> “Karena BPMN bisa menggambarkan flow, berarti semua flow harus dimasukkan ke BPMN.”

Ini keliru.

BPMN cocok untuk **business-significant state transitions**, bukan semua internal implementation step.

### 2.3 Masalah Production

God orchestrator menyebabkan:

- deployment BPMN terlalu sering untuk perubahan teknis kecil;
- process versioning menjadi kacau;
- UAT sulit karena banyak path kecil;
- business user tidak lagi bisa membaca diagram;
- developer sulit mengetahui logic mana di BPMN, mana di Java;
- incident sulit karena terlalu banyak element instance;
- metric proses menjadi noisy.

### 2.4 Cara Memperbaiki

Gunakan prinsip:

```text
BPMN should model business-relevant coordination.
Java should implement local deterministic work.
Domain model should own business facts.
Integration layer should own protocol detail.
```

Contoh refactor:

Sebelum:

```text
Receive Application
  -> Validate NRIC Format
  -> Validate Email Format
  -> Check Mandatory Documents
  -> Check Applicant Type
  -> Check License Category
  -> Check Fee Formula
  -> Generate Reference No
  -> Save Application
  -> Send Ack Email
  -> Officer Review
```

Sesudah:

```text
Receive Application
  -> Validate Submission
  -> Create Application Record
  -> Notify Applicant
  -> Officer Review
```

Detail validasi format, formula, dan persistence tetap ada, tetapi di service/DMN/domain code, bukan semua jadi task BPMN.

### 2.5 Review Question

Tanyakan:

1. Apakah element ini penting untuk business visibility?
2. Apakah auditor perlu melihat element ini sebagai step terpisah?
3. Apakah user/operator perlu repair step ini secara independen?
4. Apakah SLA berbeda untuk step ini?
5. Apakah failure-nya punya business handling berbeda?

Kalau semua jawabannya “tidak”, kemungkinan element itu tidak perlu menjadi BPMN step.

---

## 3. Anti-pattern #2 — BPMN Terlalu Tipis: Semua Logic Disembunyikan di Java

Kebalikan dari God Orchestrator adalah BPMN yang terlalu tipis.

### 3.1 Gejala

Diagram terlihat seperti ini:

```text
Start
  -> Process Application
  -> End
```

Di dalam `Process Application`, Java melakukan:

- validasi;
- cek eligibility;
- payment;
- document request;
- officer assignment;
- approval;
- rejection;
- appeal;
- notification;
- escalation.

### 3.2 Masalah

Ini bukan process orchestration. Ini hanya service method panjang dengan dekorasi BPMN.

Dampaknya:

- tidak ada process visibility;
- tidak ada meaningful wait state;
- Operate/Cockpit tidak membantu;
- business tidak bisa review alur;
- audit tidak melihat decision point;
- retry teknis bisa mengulang banyak side effect sekaligus;
- incident tidak menunjukkan step yang gagal.

### 3.3 Cara Memperbaiki

Pisahkan business milestones:

```text
Receive Application
  -> Validate Eligibility
  -> Request Missing Documents? [if needed]
  -> Calculate Fee
  -> Wait for Payment
  -> Assign Officer
  -> Officer Review
  -> Approve / Reject
  -> Generate Outcome Notice
  -> Notify Applicant
```

Tetap jangan terlalu detail, tetapi business-significant step harus terlihat.

### 3.4 Heuristic

Jika nama service task adalah kata kerja generik seperti:

- `Process`
- `Handle`
- `Execute`
- `Do Business Logic`
- `Run Workflow`

maka kemungkinan BPMN terlalu tipis.

---

## 4. Anti-pattern #3 — Process Variable sebagai Database Kedua

### 4.1 Gejala

Process variable berisi seluruh domain object:

```json
{
  "application": {
    "id": "APP-001",
    "applicant": { "name": "...", "address": "...", "nric": "..." },
    "documents": [ ... huge array ... ],
    "payments": [ ... ],
    "history": [ ... ],
    "officers": [ ... ],
    "comments": [ ... ],
    "attachments": [ ... base64 ... ]
  }
}
```

### 4.2 Kenapa Berbahaya

Process variables adalah execution context, bukan canonical system of record.

Risikonya:

- payload besar memperlambat engine/exporter/search index;
- data sensitif tersebar;
- schema evolution sulit;
- domain DB dan process variable bisa berbeda;
- operator bisa mengubah variable tanpa domain invariant;
- audit tidak jelas mana fakta bisnis resmi;
- migration lebih sulit;
- query business reporting salah sumber.

### 4.3 Pattern yang Benar

Gunakan variable kecil dan bermakna:

```json
{
  "applicationId": "APP-2026-000001",
  "caseId": "CASE-2026-000041",
  "applicantType": "COMPANY",
  "licenseType": "ESTATE_AGENT",
  "riskBand": "MEDIUM",
  "paymentRequired": true,
  "reviewOutcome": "APPROVED",
  "schemaVersion": 3
}
```

Data besar tetap di domain database/document store:

```text
Process variable:
- documentSetId
- applicationId
- paymentId
- decisionId

Domain DB:
- applicant details
- submitted form
- uploaded files
- payment ledger
- audit log
```

### 4.4 Checklist Variable

Untuk setiap variable, tanya:

1. Apakah BPMN perlu variable ini untuk routing?
2. Apakah worker perlu variable ini untuk menjalankan task?
3. Apakah operator perlu melihat variable ini untuk repair?
4. Apakah variable ini aman ditampilkan di Operate/Tasklist/log?
5. Apakah variable ini stabil terhadap schema evolution?
6. Apakah ini fakta bisnis canonical? Kalau ya, kenapa tidak di domain DB?

---

## 5. Anti-pattern #4 — User Task Dipakai sebagai Status Table

### 5.1 Gejala

Tim membuat user task untuk setiap status:

```text
Application Submitted Task
Application Pending Task
Application Processing Task
Application Approved Task
Application Rejected Task
Application Closed Task
```

Padahal tidak semua status memerlukan aksi manusia.

### 5.2 Masalah

User task adalah **work item untuk manusia**, bukan status record.

Jika user task dipakai sebagai status:

- tasklist penuh task yang tidak perlu dikerjakan;
- assignment kacau;
- SLA salah;
- completed task dianggap decision padahal hanya transisi status;
- reporting task aging menjadi meaningless;
- authorization menjadi kabur.

### 5.3 Pattern yang Benar

Gunakan:

- domain status untuk entity lifecycle;
- BPMN wait state untuk proses yang menunggu event/action;
- user task hanya saat manusia perlu mengambil keputusan/aksi.

Contoh:

```text
Domain status:
SUBMITTED, UNDER_REVIEW, PENDING_DOCUMENTS, APPROVED, REJECTED

BPMN user task:
- Review Application
- Submit Clarification Response
- Approve Final Decision

BPMN service task:
- Update Application Status
- Generate Outcome Notice
```

### 5.4 Review Question

Apakah task ini memiliki:

- actor manusia jelas?
- aksi manusia jelas?
- outcome jelas?
- permission jelas?
- SLA manusia?
- audit decision?

Kalau tidak, jangan jadikan user task.

---

## 6. Anti-pattern #5 — Gateway Spaghetti

### 6.1 Gejala

Diagram penuh exclusive gateway:

```text
if A -> if B -> if C -> if D -> if E -> if F
```

Label gateway tidak jelas:

- `Check?`
- `Valid?`
- `OK?`
- `Proceed?`
- `Yes/No`

### 6.2 Masalah

Gateway spaghetti menimbulkan:

- path sulit diuji;
- kondisi overlap;
- default path tidak jelas;
- business tidak bisa review;
- DMN/rules logic tersebar;
- perubahan policy perlu ubah diagram besar;
- incident sulit karena token berada di branch tidak intuitif.

### 6.3 Pattern yang Benar

Gunakan gateway untuk routing besar, bukan micro-rule.

Sebelum:

```text
Check Applicant Type?
  -> Check License Type?
    -> Check Risk Score?
      -> Check Document Completeness?
        -> Check Payment Required?
```

Sesudah:

```text
Evaluate Application Route [DMN]
  -> Fast Track Review
  -> Standard Review
  -> Enhanced Review
  -> Reject As Ineligible
```

DMN/rules menghasilkan satu `route`, BPMN hanya routing berdasarkan decision result.

### 6.4 Gateway Checklist

Untuk setiap gateway:

1. Apakah namanya berupa pertanyaan business yang jelas?
2. Apakah outgoing flow punya label bermakna?
3. Apakah kondisi mutually exclusive?
4. Apakah ada default path?
5. Apakah rule lebih cocok di DMN?
6. Apakah jumlah branch masih manusiawi?
7. Apakah tiap branch punya business meaning?

---

## 7. Anti-pattern #6 — Service Task Non-idempotent

### 7.1 Gejala

Worker melakukan side effect langsung:

```java
paymentClient.charge(applicationId, amount);
client.newCompleteCommand(job.getKey()).send().join();
```

Tidak ada idempotency key, tidak ada dedup table, tidak ada external reference, tidak ada reconciliation.

### 7.2 Failure Window

Urutan buruk:

```text
1. Worker activates job.
2. Worker calls payment API.
3. Payment succeeds.
4. Worker crashes before complete job command succeeds.
5. Job timeout expires.
6. Another worker activates same job.
7. Payment API called again.
8. Applicant charged twice.
```

### 7.3 Pattern yang Benar

Gunakan idempotency boundary:

```text
idempotencyKey = businessOperation + processInstanceKey + elementInstanceKey
```

atau untuk domain yang lebih stabil:

```text
idempotencyKey = paymentId
```

Pola aman:

```text
Worker
  -> acquire idempotency record
  -> check existing side effect result
  -> call external API with idempotency key
  -> persist external reference
  -> complete job with result
```

### 7.4 Java Skeleton

```java
public void handle(JobClient client, ActivatedJob job) {
    PaymentCommand command = variablesMapper.toPaymentCommand(job);

    IdempotencyResult<PaymentResult> result = idempotencyService.execute(
        command.idempotencyKey(),
        () -> paymentService.charge(command)
    );

    client.newCompleteCommand(job.getKey())
        .variables(Map.of(
            "paymentId", result.value().paymentId(),
            "paymentStatus", result.value().status()
        ))
        .send()
        .join();
}
```

Catatan: `idempotencyService.execute` harus transactional terhadap local DB dan dirancang untuk concurrency.

---

## 8. Anti-pattern #7 — Semua Error Dianggap Technical Retry

### 8.1 Gejala

Worker menangkap semua exception dan memanggil `failJob`:

```java
catch (Exception e) {
    client.newFailCommand(job.getKey())
        .retries(job.getRetries() - 1)
        .errorMessage(e.getMessage())
        .send();
}
```

### 8.2 Masalah

Tidak semua error layak retry.

| Error | Seharusnya |
|---|---|
| external API timeout | retry/backoff |
| database temporarily unavailable | retry/backoff |
| validation business failed | BPMN error / business branch |
| applicant not eligible | BPMN outcome, bukan incident |
| duplicate business request | idempotent complete / business error |
| missing mandatory variable karena bug | incident |
| unauthorized officer action | reject request, security audit |
| payment already captured | reconcile, not blind retry |

### 8.3 Pattern yang Benar

Klasifikasikan error:

```java
try {
    service.execute(command);
    complete(job);
} catch (BusinessRuleViolation e) {
    throwBpmnError(job, e.businessCode(), e.safeMessage());
} catch (TransientTechnicalException e) {
    failWithRetry(job, e, nextRetries(job), backoff(e));
} catch (NonRetryableTechnicalException e) {
    failToIncident(job, e);
} catch (SecurityException e) {
    auditSecurityFailure(job, e);
    failToIncident(job, e);
}
```

### 8.4 Review Question

Untuk setiap service task:

1. Apa business error yang expected?
2. Apa technical error yang retryable?
3. Apa technical error yang non-retryable?
4. Apa error yang harus menjadi incident?
5. Apa error yang harus menjadi manual task?
6. Apa error yang tidak boleh mengekspos data sensitif?

---

## 9. Anti-pattern #8 — BPMN Error Dipakai untuk Technical Failure

### 9.1 Gejala

External API timeout dilempar sebagai BPMN error:

```text
Payment API timeout -> BPMN Error PAYMENT_FAILED -> Reject Application
```

### 9.2 Masalah

Timeout bukan bukti pembayaran gagal.

Timeout adalah ambiguity:

```text
Maybe payment failed.
Maybe payment succeeded but response lost.
Maybe payment still pending.
```

Jika timeout dimodelkan sebagai `PAYMENT_FAILED`, process bisa salah menolak aplikasi padahal pembayaran berhasil.

### 9.3 Pattern yang Benar

Pisahkan:

```text
Technical timeout
  -> retry with backoff
  -> if exhausted, incident or reconciliation task

Business payment declined
  -> BPMN error / business branch

Payment status unknown
  -> reconciliation process
```

### 9.4 Heuristic

Gunakan BPMN error jika:

- kondisi adalah business outcome yang diketahui;
- process bisa melanjutkan ke branch business yang meaningful;
- tidak perlu operator memperbaiki bug/infra;
- retry teknis tidak akan mengubah outcome.

Gunakan incident jika:

- process tidak bisa lanjut karena masalah teknis/data;
- perlu human/operator repair;
- outcome business belum dapat dipastikan.

---

## 10. Anti-pattern #9 — Timer Explosion

### 10.1 Gejala

Setiap instance punya banyak timer:

```text
Reminder H+1
Reminder H+2
Reminder H+3
Escalate H+4
Escalate H+5
Auto-close H+7
Notify Supervisor H+8
Notify Director H+10
```

Jika ada 500.000 active process instance, jumlah timer bisa jutaan.

### 10.2 Masalah

Timer banyak menyebabkan:

- engine/storage/search pressure;
- operational noise;
- sulit mengubah SLA;
- duplicate notification risk;
- timer firing storm;
- sulit pause/resume SLA;
- sulit support business calendar.

### 10.3 Pattern yang Benar

Gunakan gabungan:

- BPMN timer untuk milestone penting;
- task due date/follow-up untuk visibility;
- scheduled worker untuk reminder bulk;
- SLA table di domain DB untuk dynamic business calendar;
- BPMN escalation hanya untuk transition penting.

Contoh:

```text
BPMN:
Officer Review Task
  boundary timer after SLA breach -> Escalate to Supervisor

Domain/Scheduler:
- daily reminder report
- notification H-2
- dashboard aging bucket
```

### 10.4 Review Question

Untuk setiap timer:

1. Apakah timer mengubah process state?
2. Apakah timer hanya mengirim reminder?
3. Apakah timer perlu business calendar?
4. Apakah SLA bisa berubah setelah instance berjalan?
5. Berapa total timer aktif saat peak?
6. Apa yang terjadi jika timer firing terlambat?
7. Apa yang terjadi jika event datang bersamaan dengan timer?

---

## 11. Anti-pattern #10 — Message Correlation Tanpa Correlation Contract

### 11.1 Gejala

Message correlation memakai field asal-asalan:

```text
correlationKey = applicantName
correlationKey = email
correlationKey = referenceNo yang belum immutable
correlationKey = random external field
```

Atau tidak ada idempotency event ID.

### 11.2 Failure Mode

- message masuk ke process instance salah;
- message datang sebelum subscription dibuat;
- duplicate message memicu action dua kali;
- stale event dari external system lama masih diterima;
- event unauthorized diterima;
- event tidak bisa direconcile.

### 11.3 Pattern yang Benar

Message contract minimal:

```json
{
  "eventId": "uuid",
  "eventType": "PAYMENT_CONFIRMED",
  "correlationKey": "APP-2026-000001",
  "businessKey": "APP-2026-000001",
  "sourceSystem": "PAYMENT_GATEWAY",
  "occurredAt": "2026-06-17T10:15:30Z",
  "schemaVersion": 2,
  "payload": {
    "paymentId": "PAY-123",
    "status": "CONFIRMED"
  }
}
```

Inbound pattern:

```text
Receive event
  -> authenticate source
  -> validate schema
  -> deduplicate eventId
  -> store inbound event
  -> resolve correlation key
  -> publish message to Camunda
  -> mark correlation result
```

### 11.4 Review Question

1. Apa message name?
2. Apa correlation key?
3. Apakah correlation key immutable?
4. Apakah message idempotent?
5. Apa TTL-nya?
6. Apa handling jika process belum menunggu?
7. Apa handling jika process sudah lewat step itu?
8. Apakah external sender authenticated?
9. Apakah payload schema versioned?
10. Apakah event disimpan sebelum correlation?

---

## 12. Anti-pattern #11 — Parallel Flow Menulis Variable Global yang Sama

### 12.1 Gejala

Parallel multi-instance menulis variable global:

```json
{
  "reviewOutcome": "APPROVED",
  "reviewComment": "Looks fine"
}
```

Beberapa branch agency review menulis key yang sama.

### 12.2 Failure Mode

- last writer wins;
- outcome tertimpa;
- aggregation salah;
- audit kehilangan branch contribution;
- race condition tidak terlihat di test kecil.

### 12.3 Pattern yang Benar

Gunakan local variable dan aggregate result secara eksplisit.

```json
{
  "agencyReviews": [
    { "agency": "A", "outcome": "CLEARED", "reviewId": "REV-1" },
    { "agency": "B", "outcome": "CONDITION_REQUIRED", "reviewId": "REV-2" }
  ]
}
```

Atau simpan di domain DB:

```text
AGENCY_REVIEW table
- application_id
- agency_code
- outcome
- decision_at
- decided_by
- reason_code
```

BPMN cukup menerima aggregated decision:

```json
{
  "multiAgencyOutcome": "CONDITION_REQUIRED"
}
```

### 12.4 Review Question

1. Apakah parallel branch menulis variable yang sama?
2. Apakah output branch disimpan per branch?
3. Apakah aggregation deterministic?
4. Apakah partial completion condition aman?
5. Apakah cancellation branch menghapus side effect?
6. Apakah audit tahu siapa memberi outcome apa?

---

## 13. Anti-pattern #12 — Completion Condition yang Tidak Aman

### 13.1 Gejala

Multi-instance approval selesai saat satu approval masuk:

```text
completionCondition = approvedCount >= 1
```

Tetapi branch lain sedang berjalan dan mungkin sudah melakukan side effect.

### 13.2 Masalah

Completion condition dapat membatalkan instance lain. Jika branch lain punya side effect yang sudah terjadi, proses bisa kehilangan kontrol.

Contoh:

```text
Agency A approves quickly.
Completion condition met.
Agency B review task cancelled.
But Agency B already sent external clearance request.
Later Agency B sends adverse result.
Process already approved.
```

### 13.3 Pattern yang Benar

Untuk quorum/first-response pattern:

- tentukan apakah outstanding branches boleh dibatalkan;
- tentukan late event handling;
- simpan state request external;
- kirim cancellation notice jika perlu;
- reject stale response atau route to post-decision review;
- audit alasan early completion.

### 13.4 Review Question

1. Apa efek terhadap branch yang belum selesai?
2. Apakah branch yang dibatalkan sudah punya side effect?
3. Apakah late response mungkin datang?
4. Apa handling late response?
5. Apakah completion condition deterministic?
6. Apakah business setuju dengan early termination?

---

## 14. Anti-pattern #13 — Compensation Dianggap Sama dengan Rollback

### 14.1 Gejala

Tim berkata:

> “Kalau gagal, rollback saja.”

Padahal proses sudah:

- mengirim email;
- memanggil payment;
- menerbitkan dokumen;
- mengubah status di external system;
- membuat audit entry;
- memberi user task ke officer.

### 14.2 Masalah

Rollback adalah konsep transaksi lokal. Compensation adalah aksi bisnis baru yang membalikkan/menetralisir efek dari aksi sebelumnya.

```text
Database rollback:
- seolah-olah aksi tidak pernah terjadi.

Business compensation:
- aksi sudah terjadi.
- kita membuat aksi korektif yang terlihat dan diaudit.
```

### 14.3 Pattern yang Benar

Untuk setiap side effect penting, desain compensation:

| Side Effect | Compensation |
|---|---|
| payment captured | refund/void payment |
| license issued | revoke/cancel license |
| email sent | send correction notice |
| document generated | mark document superseded |
| external system updated | send reversal/update event |
| task assigned | cancel task with reason |

### 14.4 Review Question

1. Side effect apa yang irreversible?
2. Side effect apa yang legally visible?
3. Compensation apa yang tersedia?
4. Apakah compensation idempotent?
5. Siapa boleh memicu compensation?
6. Apakah compensation sendiri bisa gagal?
7. Apakah compensation perlu approval?
8. Apakah audit menunjukkan original action dan corrective action?

---

## 15. Anti-pattern #14 — Process Versioning Dianggap Sama dengan Redeploy

### 15.1 Gejala

Tim deploy BPMN baru dan mengira semua instance lama otomatis ikut model baru.

Atau sebaliknya, tim mengubah worker code tanpa mempertimbangkan instance lama yang masih memakai variable/task contract lama.

### 15.2 Masalah

Running process instance punya posisi, variable, element ID, dan contract pada saat ia dibuat. Deploy versi baru tidak otomatis memperbaiki instance lama.

Risiko:

- worker baru tidak mengerti variable lama;
- element ID berubah sehingga migration sulit;
- call activity binding berubah tanpa kontrol;
- DMN result contract berubah;
- form field berubah dan task lama rusak;
- rollback aplikasi tidak rollback process instance yang sudah berjalan.

### 15.3 Pattern yang Benar

Gunakan compatibility matrix:

| Artifact | Versioning Concern |
|---|---|
| BPMN | element ID, path, variable contract |
| DMN | input/output contract, hit policy |
| form | field compatibility |
| worker | job type, variable DTO, error code |
| domain API | command/result schema |
| UI | task type, form schema, action permission |

Deployment strategy:

```text
1. Deploy backward-compatible worker.
2. Deploy DMN/form if compatible.
3. Deploy BPMN new version.
4. Route only new instances to new version.
5. Monitor mixed-version execution.
6. Migrate old instances only with explicit plan.
```

### 15.4 Review Question

1. Apakah perubahan BPMN backward compatible?
2. Apakah element ID stabil?
3. Apakah variable schema berubah?
4. Apakah worker support old and new contract?
5. Apakah running instances perlu migration?
6. Apakah ada rollback plan realistis?
7. Apakah process version tercatat di domain/audit?
8. Apakah UAT menguji old instance + new worker?

---

## 16. Anti-pattern #15 — Repair Langsung di Database Engine

### 16.1 Gejala

Saat incident, operator/developer langsung update table runtime/history engine.

```sql
UPDATE ACT_RU_VARIABLE SET ...
UPDATE ACT_RU_JOB SET RETRIES_ = 3
DELETE FROM ...
```

Atau di Camunda 8, mencoba mengubah backing store/exporter/search index secara manual.

### 16.2 Masalah

Engine state punya invariant internal. Manual DB modification dapat menyebabkan:

- corrupted execution tree;
- missing history;
- inconsistent job state;
- broken migration;
- audit gap;
- unsupported state;
- future upgrade failure.

### 16.3 Pattern yang Benar

Gunakan supported operation:

- update variable via API/Operate;
- increase retries/update job;
- resolve incident;
- process instance modification;
- process instance migration;
- cancel instance;
- batch operation;
- domain repair command.

Repair harus punya:

```text
repairId
processInstanceKey
caseId/applicationId
incidentKey
reason
before snapshot
after snapshot
approvedBy
executedBy
executedAt
supporting evidence
```

### 16.4 Review Question

1. Apakah repair memakai supported API?
2. Apakah repair mengubah fakta bisnis atau hanya execution state?
3. Apakah ada approval?
4. Apakah before/after tercatat?
5. Apakah domain DB dan process state tetap konsisten?
6. Apakah user/auditor perlu diberi notice?

---

## 17. Anti-pattern #16 — Observability Hanya Technical Logs

### 17.1 Gejala

Log seperti ini:

```text
Worker started
Calling API
API failed
Retrying
Completed
```

Tidak ada:

- process instance key;
- business key;
- application ID;
- job key;
- element ID;
- user ID;
- correlation ID;
- error classification;
- side effect reference.

### 17.2 Masalah

Saat incident, tim tidak bisa menjawab:

- case mana terdampak?
- step mana yang gagal?
- apakah side effect sudah terjadi?
- apakah retry aman?
- siapa user terakhir?
- apakah SLA breach?
- apakah duplicate event terjadi?

### 17.3 Pattern yang Benar

Structured log minimal:

```json
{
  "event": "worker.payment.charge.failed",
  "processInstanceKey": "2251799813685251",
  "elementInstanceKey": "2251799813685302",
  "jobKey": "2251799813685310",
  "bpmnProcessId": "application-review",
  "processVersion": 12,
  "businessKey": "APP-2026-000001",
  "applicationId": "APP-2026-000001",
  "taskType": "payment-charge",
  "idempotencyKey": "PAY-2026-001",
  "errorCategory": "TRANSIENT_EXTERNAL",
  "externalSystem": "PAYMENT_GATEWAY",
  "externalReference": "PG-777",
  "attempt": 2,
  "remainingRetries": 1
}
```

### 17.4 Review Question

1. Bisa cari semua log untuk satu case?
2. Bisa cari semua log untuk satu process instance?
3. Bisa cari semua side effect untuk satu job?
4. Bisa bedakan business error vs technical failure?
5. Bisa tahu retry sudah berapa kali?
6. Bisa trace inbound event sampai process continuation?
7. Bisa explain outcome ke auditor?

---

## 18. Anti-pattern #17 — Audit Disamakan dengan Log

### 18.1 Gejala

Tim berkata:

> “Audit ada di log.”

### 18.2 Masalah

Log dan audit berbeda.

| Aspek | Log | Audit |
|---|---|---|
| Tujuan | debugging/observability | accountability/evidence |
| Format | teknis | business/legal-readable |
| Retention | relatif pendek | sesuai kebijakan/regulasi |
| Mutability | bisa rotate/drop | tamper-evident/controlled |
| Actor | service/thread | human/system actor jelas |
| Meaning | event teknis | keputusan/aksi resmi |

### 18.3 Pattern yang Benar

Audit event minimal:

```json
{
  "auditEventId": "AUD-001",
  "caseId": "CASE-2026-000001",
  "processInstanceKey": "225179...",
  "businessAction": "APPLICATION_APPROVED",
  "actorType": "USER",
  "actorId": "officer-123",
  "role": "SENIOR_OFFICER",
  "decision": "APPROVE",
  "reasonCode": "ELIGIBLE",
  "beforeState": "UNDER_REVIEW",
  "afterState": "APPROVED",
  "occurredAt": "2026-06-17T10:00:00Z",
  "source": "TASK_COMPLETE",
  "evidenceRefs": ["DOC-1", "DMN-RESULT-9"]
}
```

### 18.4 Review Question

1. Apakah setiap decision manusia diaudit?
2. Apakah setiap automated decision punya rule/version snapshot?
3. Apakah correction/repair diaudit?
4. Apakah audit memakai business language?
5. Apakah audit immutable atau controlled?
6. Apakah audit retention sesuai kebutuhan?
7. Apakah audit dapat direkonstruksi tanpa membaca raw engine table?

---

## 19. Anti-pattern #18 — Authorization Hanya di UI

### 19.1 Gejala

UI menyembunyikan tombol, tetapi backend tidak enforce.

```text
Officer tidak melihat tombol Approve di UI.
Tapi jika panggil API /tasks/{id}/complete dengan outcome=APPROVE, request diterima.
```

### 19.2 Masalah

Workflow system sering memiliki action high-impact:

- approve/reject application;
- revoke license;
- waive fee;
- close enforcement case;
- modify process variable;
- resolve incident;
- migrate instance.

Authorization tidak boleh hanya di UI.

### 19.3 Pattern yang Benar

Authorization harus dilakukan di backend/domain layer:

```text
Task completion request
  -> authenticate user
  -> load task context
  -> load domain case
  -> check task ownership/candidate group
  -> check domain permission
  -> check maker-checker constraint
  -> check state invariant
  -> save business decision
  -> complete user task
```

### 19.4 Review Question

1. Apakah setiap task action dicek di backend?
2. Apakah assignee/candidate group cukup, atau perlu domain permission?
3. Apakah maker-checker enforced?
4. Apakah delegation/reassignment audited?
5. Apakah operator repair punya separate privilege?
6. Apakah service account scope minimal?
7. Apakah API idempotent terhadap double submit?

---

## 20. Anti-pattern #19 — Task Completion Tidak Transactionally Safe

### 20.1 Gejala

Backend complete Camunda task dulu, baru save domain decision.

```text
complete user task
save approval decision
send notification
```

Jika save domain decision gagal setelah task completed, process sudah lanjut tetapi domain DB tidak punya decision.

Sebaliknya:

```text
save approval decision
complete user task
```

Jika complete task gagal setelah decision saved, user mungkin retry dan duplicate action terjadi.

### 20.2 Pattern yang Benar

Gunakan command ID, idempotency, dan explicit state.

```text
1. Receive complete task command with commandId.
2. Validate authorization and domain invariant.
3. Persist decision as PENDING_PROCESS_COMPLETION.
4. Complete Camunda task with decision variables.
5. Mark decision as PROCESS_COMPLETED.
6. Outbox emits notification/event.
```

Jika step 4 gagal, retry completion command berdasarkan commandId.

### 20.3 Review Question

1. Apa yang terjadi jika user double-click complete?
2. Apa yang terjadi jika domain save sukses tetapi task complete gagal?
3. Apa yang terjadi jika task complete sukses tetapi response ke browser timeout?
4. Apakah command idempotent?
5. Apakah decision dan process transition bisa direconcile?

---

## 21. Anti-pattern #20 — External System Down Membekukan Semua Process

### 21.1 Gejala

Satu external API lambat/down, semua worker thread habis menunggu.

Dampak:

- unrelated job ikut stuck;
- job timeout massal;
- retry storm;
- incident flood;
- engine backpressure;
- database connection pool exhausted;
- SLA breach besar.

### 21.2 Pattern yang Benar

Gunakan isolation:

- worker pool per task type;
- timeout per integration;
- bulkhead per external system;
- circuit breaker;
- rate limiter;
- retry budget;
- fallback to incident/reconciliation;
- external system health metric;
- queue/outbox for async integration.

### 21.3 Review Question

1. Apakah worker untuk payment bisa menghabiskan thread worker untuk notification?
2. Apakah external timeout lebih kecil dari job timeout?
3. Apakah retry storm dicegah?
4. Apakah circuit breaker menghasilkan controlled failure?
5. Apakah ada manual recovery saat external system pulih?
6. Apakah incident bulk bisa diretry aman?

---

## 22. Anti-pattern #21 — Process Model Tidak Punya Ownership

### 22.1 Gejala

Tidak jelas siapa pemilik:

- BPMN model;
- DMN decision;
- worker code;
- task UI;
- domain invariant;
- runbook;
- incident resolution;
- audit interpretation.

Akibatnya, perubahan kecil memicu debat panjang atau perubahan sembarangan.

### 22.2 Pattern yang Benar

Tetapkan ownership matrix:

| Artifact | Owner | Reviewer | Approval |
|---|---|---|---|
| BPMN process | process engineer / tech lead | BA, domain owner, QA, ops | product/domain owner |
| DMN rule | policy owner | developer, QA | business owner |
| worker code | engineering team | tech lead | engineering process |
| task UI | product/app team | UX, security | product owner |
| domain invariant | domain architect | engineering + business | domain owner |
| repair runbook | ops + engineering | audit/security | production owner |
| audit event catalog | domain + compliance | engineering | compliance owner |

### 22.3 Review Question

1. Siapa boleh mengubah BPMN?
2. Siapa boleh mengubah DMN?
3. Siapa approve process migration?
4. Siapa resolve production incident?
5. Siapa boleh modify variable?
6. Siapa explain audit trail?
7. Siapa bertanggung jawab terhadap SLA model?

---

## 23. Anti-pattern #22 — Tidak Ada Negative-path Testing

### 23.1 Gejala

Test hanya happy path:

```text
Start -> Validate -> Review -> Approve -> End
```

Tidak ada test untuk:

- invalid input;
- BPMN error;
- job retry;
- incident;
- timer expiry;
- duplicate message;
- late message;
- worker crash window;
- compensation;
- migration;
- unauthorized complete;
- multi-instance race.

### 23.2 Masalah

Workflow failure biasanya terjadi di negative path, bukan happy path.

### 23.3 Pattern yang Benar

Minimal test suite:

| Category | Test |
|---|---|
| model | BPMN deployable, naming, extension elements |
| happy path | standard end-to-end |
| business branch | approve/reject/request info |
| BPMN error | known business exception |
| technical failure | retry then success |
| incident | retry exhausted |
| timer | reminder/escalation/expiry |
| message | early/late/duplicate/wrong key |
| user task | authorization, double submit |
| parallel | aggregation/quorum/cancellation |
| compensation | side effect reversal |
| migration | old instance to new version |
| observability | required identifiers emitted |

### 23.4 Review Question

1. Apakah setiap gateway branch punya test?
2. Apakah setiap boundary event punya test?
3. Apakah setiap BPMN error code punya test?
4. Apakah incident path punya runbook test?
5. Apakah duplicate/late message diuji?
6. Apakah unauthorized task completion diuji?
7. Apakah migration diuji dengan active old instance?

---

## 24. Anti-pattern #23 — “Business Key” Tidak Konsisten

### 24.1 Gejala

Kadang memakai `applicationId`, kadang `caseId`, kadang `referenceNo`, kadang `processInstanceKey`.

### 24.2 Masalah

Tanpa identifier strategy:

- logs sulit dicari;
- correlation salah;
- UI sulit link ke process;
- audit terputus;
- incident triage lama;
- reporting berantakan;
- support tidak tahu case mana terkena.

### 24.3 Pattern yang Benar

Tentukan identifier hierarchy:

```text
processInstanceKey : engine runtime identifier
bpmnProcessId      : process definition logical id
processVersion     : deployed process version
businessKey        : stable business correlation id
caseId             : regulatory case id
applicationId      : application aggregate id
taskId             : human task id
commandId          : idempotency id for user/API commands
eventId            : idempotency id for inbound events
externalRef        : external system transaction reference
```

### 24.4 Review Question

1. Identifier mana yang dipakai untuk correlation?
2. Identifier mana yang dipakai untuk audit?
3. Identifier mana yang dipakai untuk support search?
4. Identifier mana yang dikirim ke external system?
5. Identifier mana yang immutable?
6. Identifier mana yang boleh berubah?

---

## 25. Anti-pattern #24 — Domain State Disimpulkan dari Posisi Token

### 25.1 Gejala

UI menampilkan status aplikasi dengan membaca process instance sedang berada di task apa.

```text
If token at Officer Review -> status UNDER_REVIEW
If token at Payment Wait -> status PENDING_PAYMENT
```

### 25.2 Masalah

Token position bukan canonical business status.

Satu process bisa punya:

- parallel token;
- event subprocess;
- compensation;
- migration;
- repair modification;
- waiting message;
- active user task;
- active timer;
- completed domain status.

Jika UI/domain status dihitung dari token mentah, status bisa salah.

### 25.3 Pattern yang Benar

Domain aggregate menyimpan status resmi:

```text
APPLICATION.status = UNDER_REVIEW
APPLICATION.subStatus = WAITING_AGENCY_CLEARANCE
APPLICATION.statusReason = AGENCY_REVIEW_IN_PROGRESS
```

BPMN mengorkestrasi transisi, tetapi domain service menetapkan status berdasarkan invariant.

### 25.4 Review Question

1. Apa source of truth status domain?
2. Apakah process token hanya operational state?
3. Apakah status update idempotent?
4. Apakah status transition punya invariant?
5. Apakah status bisa direconstruct dari audit?
6. Apakah process repair mempengaruhi domain status secara aman?

---

## 26. Anti-pattern #25 — Semua Proses Dibuat Synchronous

### 26.1 Gejala

HTTP request dari user menunggu seluruh process selesai.

```text
POST /applications
  -> start process
  -> validate
  -> call external agency
  -> call payment
  -> generate PDF
  -> send email
  -> return response
```

### 26.2 Masalah

Long-running process tidak cocok diselesaikan dalam satu HTTP request.

Dampak:

- browser timeout;
- API gateway timeout;
- duplicate submit;
- user experience buruk;
- external system latency membocor ke UI;
- transaction boundary kacau;
- process visibility berkurang.

### 26.3 Pattern yang Benar

Gunakan asynchronous process start:

```text
POST /applications
  -> validate minimum command
  -> create application record
  -> start process instance
  -> return 202 Accepted / applicationId

GET /applications/{id}
  -> query domain state/progress
```

Untuk aksi user task:

```text
POST /tasks/{id}/complete
  -> persist command/decision
  -> complete task
  -> return accepted/current status
```

### 26.4 Review Question

1. Apakah operation bisa selesai dalam satu request secara reliable?
2. Apakah external dependency terlibat?
3. Apakah user perlu immediate final result atau hanya acknowledgment?
4. Apakah retry browser aman?
5. Apakah command idempotent?

---

## 27. Anti-pattern #26 — Dynamic BPMN untuk Semua Variasi Bisnis

### 27.1 Gejala

Setiap variasi policy membuat process definition baru:

- application type A process;
- application type B process;
- application type C process;
- renewal process minor variation;
- agency-specific variant;
- special route variant.

### 27.2 Masalah

Process definition explosion:

- sulit maintain;
- worker contract duplicate;
- migration banyak;
- monitoring tersebar;
- BA bingung;
- regression test membengkak.

### 27.3 Pattern yang Benar

Gunakan kombinasi:

- BPMN untuk lifecycle besar;
- DMN untuk decision variation;
- configuration untuk SLA/assignment;
- call activity untuk reusable subflow;
- domain rule service untuk complex policy;
- separate BPMN hanya jika lifecycle benar-benar berbeda.

### 27.4 Review Question

1. Apakah variasinya lifecycle atau hanya rule?
2. Apakah branch bisa dihasilkan DMN?
3. Apakah SLA/assignment bisa config?
4. Apakah process baru punya ownership berbeda?
5. Apakah process baru perlu independent deployment/versioning?

---

## 28. Failure Mode Catalog

Bagian ini merangkum failure mode yang harus dipikirkan setiap desain process.

### 28.1 Worker Failure Modes

| Failure Mode | Contoh | Mitigation |
|---|---|---|
| worker crash before side effect | job retried aman | retry normal |
| worker crash after side effect before complete | duplicate side effect | idempotency/dedup/reconcile |
| complete command timeout | process may or may not complete | query/retry idempotently |
| malformed variable | worker fails repeatedly | incident + variable correction |
| non-deterministic worker | output berubah saat retry | deterministic command/result |
| worker version mismatch | old instance variable tidak cocok | backward-compatible DTO |
| thread starvation | external API down | bulkhead/timeouts/circuit breaker |

### 28.2 Message Failure Modes

| Failure Mode | Contoh | Mitigation |
|---|---|---|
| early message | process belum menunggu | TTL/inbound event table |
| late message | process sudah lewat | stale event handling |
| duplicate message | broker/external retry | eventId dedup |
| wrong key | correlated ke instance salah | immutable correlation key |
| missing auth | spoofed event | mTLS/signature/token |
| schema drift | payload berubah | schema versioning |
| poison event | invalid but repeated | quarantine + manual review |

### 28.3 User Task Failure Modes

| Failure Mode | Contoh | Mitigation |
|---|---|---|
| unauthorized complete | API called directly | backend authorization |
| double submit | user double click | command idempotency |
| stale task | task already completed/cancelled | reload task context |
| maker-checker violation | same user creates and approves | domain invariant |
| reassignment abuse | task moved improperly | audit + permission |
| missing reason | reject without reason | form validation/domain rule |
| task stuck | assignee resigned | SLA dashboard/reassignment |

### 28.4 Timer Failure Modes

| Failure Mode | Contoh | Mitigation |
|---|---|---|
| timer storm | many timers fire at once | capacity, batching, spread schedule |
| wrong timezone | expiry too early/late | UTC + business timezone rule |
| business calendar mismatch | holiday counted incorrectly | calendar service/domain SLA |
| event-timer race | payment and expiry happen same time | deterministic resolution policy |
| SLA pause missing | waiting applicant counted | SLA state machine |
| dynamic SLA change | policy update | versioned SLA config |

### 28.5 Migration Failure Modes

| Failure Mode | Contoh | Mitigation |
|---|---|---|
| element ID changed | migration mapping fails | stable BPMN IDs |
| active task removed | instance stuck | migration plan/modification |
| variable schema changed | worker fails | schemaVersion + mapper |
| worker incompatible | old job fails | multi-version support |
| call activity binding changed | unexpected subflow | explicit binding strategy |
| form incompatible | old task UI breaks | form version support |

---

## 29. Design Review Checklist — Executive Version

Gunakan ini untuk review cepat.

### 29.1 Business Process Fit

- [ ] Apakah problem ini benar-benar long-running business process?
- [ ] Apakah membutuhkan human task, SLA, audit, event, atau compensation?
- [ ] Apakah BPMN lebih cocok daripada simple CRUD/state machine/job scheduler?
- [ ] Apakah diagram menampilkan business-significant milestones?
- [ ] Apakah diagram tidak terlalu detail secara teknis?

### 29.2 BPMN Model Quality

- [ ] Nama process jelas.
- [ ] BPMN ID stabil dan readable.
- [ ] Start/end event jelas.
- [ ] Gateway bernama business question.
- [ ] Outgoing sequence flow berlabel jelas.
- [ ] Boundary event punya purpose jelas.
- [ ] Timer tidak dipakai sebagai reminder massal tanpa alasan.
- [ ] Subprocess/call activity punya boundary jelas.
- [ ] Multi-instance punya aggregation strategy.
- [ ] Compensation hanya untuk side effect yang sudah berhasil.

### 29.3 Data Contract

- [ ] Variable kecil dan meaningful.
- [ ] Variable bukan domain database.
- [ ] Sensitive data diminimalkan.
- [ ] Large payload tidak disimpan di process variable.
- [ ] Variable schema versioned.
- [ ] Input/output mapping jelas.
- [ ] Parallel branch tidak overwrite variable global.

### 29.4 Java Worker

- [ ] Worker idempotent.
- [ ] External side effect punya idempotency key.
- [ ] Error diklasifikasi: business, retryable technical, non-retryable technical, security.
- [ ] Retry/backoff disesuaikan dengan dependency.
- [ ] Job timeout lebih besar dari expected work duration.
- [ ] Worker punya graceful shutdown.
- [ ] Worker log menyertakan process/job/business identifiers.
- [ ] Worker compatible dengan process version lama yang masih aktif.

### 29.5 Human Workflow

- [ ] User task hanya untuk aksi manusia nyata.
- [ ] Assignment/candidate group jelas.
- [ ] Backend enforce authorization.
- [ ] Maker-checker enforced.
- [ ] Complete task idempotent.
- [ ] Form contract versioned.
- [ ] SLA/due date/follow-up jelas.
- [ ] Reassignment/delegation diaudit.

### 29.6 Integration

- [ ] Message correlation key immutable.
- [ ] Inbound event dedup tersedia.
- [ ] Early/late/duplicate message handled.
- [ ] External API timeout tidak dianggap business failure.
- [ ] Circuit breaker/bulkhead/rate limit tersedia.
- [ ] External reference disimpan.
- [ ] Reconciliation path tersedia untuk ambiguous side effect.

### 29.7 Operations

- [ ] Incident taxonomy jelas.
- [ ] Runbook tersedia untuk setiap incident penting.
- [ ] Repair memakai supported API.
- [ ] Variable correction diaudit.
- [ ] Retry bulk aman.
- [ ] Process modification/migration punya approval.
- [ ] Domain state dan process state bisa direconcile.

### 29.8 Observability and Audit

- [ ] Structured logs punya correlation identifiers.
- [ ] Metrics mencakup worker, process, business SLA.
- [ ] Dashboards menampilkan active, stuck, incident, SLA breach.
- [ ] Audit event bukan sekadar log.
- [ ] Audit mencatat actor, action, reason, before/after, evidence.
- [ ] Operator bisa menjawab “kenapa case ini berakhir seperti ini?”

### 29.9 Security

- [ ] Platform API protected.
- [ ] Worker credential minimal scope.
- [ ] Task completion authorized di backend.
- [ ] Message source authenticated.
- [ ] Sensitive variable minimized.
- [ ] Repair/migration privilege separated.
- [ ] Security events audited.

### 29.10 Versioning and Change

- [ ] Deployment order aman.
- [ ] BPMN/DMN/form/worker compatibility dicek.
- [ ] Running instance strategy jelas.
- [ ] Migration plan jika perlu.
- [ ] Rollback limitation dipahami.
- [ ] Regression tests cover old + new process.

---

## 30. Design Review Checklist — Deep Technical Version

Gunakan bagian ini untuk review sebelum production.

### 30.1 Process Boundary

- [ ] Apakah process boundary merepresentasikan lifecycle bisnis yang utuh?
- [ ] Apakah process terlalu besar dan seharusnya dipisah menjadi call activity?
- [ ] Apakah process terlalu kecil dan hanya membungkus satu service call?
- [ ] Apakah process memiliki business owner?
- [ ] Apakah process memiliki clear start trigger?
- [ ] Apakah process memiliki clear completion condition?
- [ ] Apakah cancellation semantics jelas?
- [ ] Apakah reopening/appeal/rework dimodelkan atau menjadi process baru?

### 30.2 Wait State

- [ ] Setiap wait state punya alasan jelas.
- [ ] User task punya actor dan outcome.
- [ ] Message catch event punya correlation contract.
- [ ] Timer punya business meaning.
- [ ] Receive task/message event tidak menunggu sesuatu yang mungkin tidak pernah datang tanpa timeout.
- [ ] Wait state punya dashboard/monitoring.

### 30.3 Gateway and Decision

- [ ] Gateway tidak mengandung rule kompleks yang lebih cocok di DMN.
- [ ] Gateway condition tidak overlap.
- [ ] Gateway punya default/fallback jika perlu.
- [ ] Inclusive gateway digunakan dengan hati-hati.
- [ ] Parallel join tidak menunggu branch yang mungkin tidak pernah aktif.
- [ ] Event-based gateway punya race semantics yang dipahami.

### 30.4 Error and Incident

- [ ] Business error code terdaftar.
- [ ] BPMN error boundary menangkap error yang expected.
- [ ] Technical error tidak dilempar sebagai BPMN error.
- [ ] Incident path punya runbook.
- [ ] Retry count dan backoff sesuai dependency.
- [ ] Non-retryable bug berhenti sebagai incident, bukan retry storm.
- [ ] Error message tidak bocor data sensitif.

### 30.5 Compensation and Saga

- [ ] Setiap irreversible side effect diidentifikasi.
- [ ] Compensation tersedia jika dibutuhkan.
- [ ] Compensation idempotent.
- [ ] Compensation failure punya handling.
- [ ] Forward recovery dipilih saat compensation berbahaya.
- [ ] Audit membedakan action original dan compensation.

### 30.6 Worker Contract

- [ ] Job type stable dan named by business operation.
- [ ] Input variable minimal.
- [ ] Output variable minimal.
- [ ] Worker validates input schema.
- [ ] Worker handles missing variable safely.
- [ ] Worker has deterministic side effect strategy.
- [ ] Worker can run multiple versions where needed.
- [ ] Worker metrics enabled.
- [ ] Worker shutdown drains active jobs or allows safe retry.

### 30.7 Domain Consistency

- [ ] Domain aggregate is source of truth for business facts.
- [ ] Process variable is execution context only.
- [ ] Domain status transition is invariant-protected.
- [ ] Task completion persists domain decision safely.
- [ ] Domain event/outbox used for integration where needed.
- [ ] Reconciliation job exists for ambiguous states.

### 30.8 Performance

- [ ] Estimated process starts/sec known.
- [ ] Estimated jobs/sec known.
- [ ] Estimated active instances known.
- [ ] Timer volume estimated.
- [ ] Message correlation volume estimated.
- [ ] Worker concurrency configured per dependency.
- [ ] Payload size measured.
- [ ] Load test includes negative paths.
- [ ] Backpressure observed under stress.

### 30.9 Operability

- [ ] Operator can search by business key.
- [ ] Operator can see process variables needed for repair.
- [ ] Operator knows which variables are safe to modify.
- [ ] Operator knows how to retry job safely.
- [ ] Operator knows when not to retry.
- [ ] Operator knows when to escalate to business owner.
- [ ] Runbooks are tested.

---

## 31. Worked Review Example — Regulatory Application Process

### 31.1 Initial Design

```text
Start Application
  -> Validate Application
  -> Call External Agency
  -> Wait for Payment
  -> Officer Review
  -> Approve?
     -> Generate License
     -> Send Email
     -> End
     -> Reject
     -> Send Email
     -> End
```

Kelihatan wajar. Tapi review senior menemukan banyak gap.

### 31.2 Review Findings

#### Gap 1 — External Agency Call Synchronous

Pertanyaan:

- apakah agency response langsung?
- apakah ada timeout?
- apakah response bisa datang via webhook?
- apakah duplicate response mungkin?

Refactor:

```text
Submit Agency Clearance Request
  -> Wait for Agency Clearance Message
     boundary timer -> Escalate/Manual Follow-up
```

#### Gap 2 — Payment Ambiguity

Pertanyaan:

- apakah payment timeout berarti gagal?
- apakah payment provider support idempotency key?
- apakah ada reconciliation?

Refactor:

```text
Initiate Payment
  -> Wait for Payment Confirmation
     boundary timer -> Check Payment Status / Manual Reconcile
```

#### Gap 3 — Officer Review Authorization

Pertanyaan:

- siapa boleh approve?
- apakah maker-checker?
- apakah officer yang submit clarification boleh approve?
- apakah rejection wajib reason?

Refactor:

```text
Officer Review User Task
  backend complete command:
    - check assignee/candidate group
    - check domain permission
    - enforce maker-checker
    - save decision + reason
    - complete task idempotently
```

#### Gap 4 — Generate License Side Effect

Pertanyaan:

- apakah license issuance idempotent?
- jika email gagal setelah license issued, apa statusnya?
- jika process retry, apakah license generated dua kali?

Refactor:

```text
Issue License
  idempotencyKey = licenseId
  output: licenseId, licenseVersion

Notify Applicant
  retryable notification; no rollback of license issuance
```

#### Gap 5 — Audit Gap

Pertanyaan:

- apakah eligibility decision captured?
- apakah DMN version captured?
- apakah officer reason captured?
- apakah repair captured?

Refactor:

```text
Audit events:
- APPLICATION_SUBMITTED
- ELIGIBILITY_EVALUATED
- AGENCY_CLEARANCE_RECEIVED
- PAYMENT_CONFIRMED
- OFFICER_DECISION_RECORDED
- LICENSE_ISSUED
- APPLICANT_NOTIFIED
```

### 31.3 Improved Process Sketch

```text
Application Submitted
  -> Evaluate Eligibility [DMN]
  -> Eligible?
     no -> Record Rejection Decision -> Notify Applicant -> End
     yes -> Create Case Record
          -> Submit Agency Clearance Request
          -> Wait for Agency Clearance
             boundary timer -> Manual Agency Follow-up
          -> Clearance Outcome?
             adverse -> Officer Review / Reject Path
             cleared -> Calculate Fee [DMN]
                    -> Payment Required?
                       yes -> Initiate Payment
                            -> Wait for Payment Confirmation
                               boundary timer -> Reconcile Payment
                       no -> Continue
                    -> Officer Review User Task
                    -> Senior Approval Required? [DMN]
                       yes -> Senior Approval User Task
                       no -> Continue
                    -> Issue License
                    -> Notify Applicant
                    -> End
```

### 31.4 Production Readiness Result

Model lebih panjang, tetapi lebih benar karena:

- wait state explicit;
- external event explicit;
- timer meaningful;
- DMN separates policy;
- human decision explicit;
- side effect boundary clear;
- compensation/reconciliation possible;
- audit events aligned with business.

---

## 32. Review Meeting Format

Untuk process design review, jangan hanya share BPMN diagram. Gunakan paket berikut.

### 32.1 Required Artifacts

```text
1. BPMN diagram
2. Process narrative
3. Variable contract
4. Message contract
5. Worker contract
6. User task contract
7. DMN/rule contract
8. Error taxonomy
9. Incident runbook
10. Audit event catalog
11. Authorization matrix
12. Versioning/migration notes
13. Test scenario matrix
14. Observability dashboard sketch
```

### 32.2 Review Agenda

```text
1. Business lifecycle walkthrough
2. Happy path walkthrough
3. Negative path walkthrough
4. External system failure walkthrough
5. Duplicate/retry walkthrough
6. Human task security walkthrough
7. SLA/timer walkthrough
8. Incident repair walkthrough
9. Migration/change walkthrough
10. Audit reconstruction walkthrough
```

### 32.3 The “Two Years Later” Test

Tanyakan:

> “Jika dua tahun lagi auditor bertanya kenapa case ini disetujui, siapa yang menyetujui, rule apa yang dipakai, data apa yang tersedia saat itu, apakah ada repair, apakah ada external response, dan apakah SLA dilanggar — bisakah sistem menjawab tanpa reverse engineering log mentah?”

Jika tidak, desain belum production-grade untuk sistem regulatori.

---

## 33. Design Smell Catalog

Gunakan daftar ini sebagai detektor awal.

### 33.1 Naming Smells

- task bernama `Process Data`;
- gateway bernama `Check?`;
- variable bernama `data`, `payload`, `result`;
- job type bernama `service-task-1`;
- BPMN ID auto-generated tanpa makna;
- error code berupa exception class teknis.

### 33.2 Modeling Smells

- diagram terlalu besar untuk satu layar dan tidak punya subprocess;
- nested gateway lebih dari 3 level;
- tidak ada boundary event untuk external wait;
- timer banyak hanya untuk reminder;
- user task tanpa actor jelas;
- service task tanpa failure semantics;
- no end-state distinction antara approved/rejected/cancelled.

### 33.3 Data Smells

- process variable berisi full domain object;
- base64 file di variable;
- PII lengkap di variable;
- variable schema tidak versioned;
- parallel branch menulis variable sama;
- variable dipakai sebagai source of truth status.

### 33.4 Worker Smells

- no idempotency;
- catch all exception -> fail job;
- business exception -> incident;
- technical timeout -> BPMN error;
- no external reference stored;
- no command id;
- no correlation id;
- worker terlalu banyak dependency;
- worker melakukan DB transaction panjang sambil menunggu external API.

### 33.5 Operation Smells

- incident diselesaikan dengan SQL manual;
- tidak ada runbook;
- support tidak tahu safe retry atau tidak;
- variable repair tidak diaudit;
- dashboard hanya CPU/memory;
- alert hanya engine down, bukan stuck business process;
- process migration dilakukan tanpa dry run.

### 33.6 Security Smells

- task authorization hanya UI;
- service account punya admin penuh;
- message endpoint tanpa authentication kuat;
- operator bisa modify variable tanpa approval;
- sensitive variable muncul di logs;
- audit event bisa diedit bebas.

---

## 34. Practical Scoring Model

Untuk review cepat, beri skor 0–3.

```text
0 = tidak ada / tidak dipikirkan
1 = ada secara informal
2 = ada desain tertulis dan sebagian diuji
3 = production-grade, diuji, observable, punya runbook
```

### 34.1 Scorecard

| Dimension | Score |
|---|---:|
| BPMN clarity | 0–3 |
| Boundary correctness | 0–3 |
| Variable governance | 0–3 |
| Worker idempotency | 0–3 |
| Error classification | 0–3 |
| Message correlation | 0–3 |
| Timer/SLA design | 0–3 |
| Human task authorization | 0–3 |
| Auditability | 0–3 |
| Observability | 0–3 |
| Operability/runbook | 0–3 |
| Versioning/migration | 0–3 |
| Security/data protection | 0–3 |
| Testing negative paths | 0–3 |
| Performance/capacity | 0–3 |

Maximum: 45.

Interpretasi:

| Score | Meaning |
|---:|---|
| 0–15 | prototype only; high production risk |
| 16–25 | workable but fragile |
| 26–35 | acceptable for controlled production with improvement plan |
| 36–45 | strong production-grade workflow design |

Untuk sistem regulatori, jangan production jika skor critical dimension berikut di bawah 2:

- worker idempotency;
- human task authorization;
- auditability;
- error classification;
- operability/runbook;
- variable governance.

---

## 35. Top 1% Engineering Habits for BPMN/Camunda Review

### 35.1 Selalu Tanya “What If It Happens Twice?”

- user submit dua kali;
- message datang dua kali;
- worker execute dua kali;
- email dikirim dua kali;
- payment diproses dua kali;
- operator retry dua kali.

Jika jawabannya tidak jelas, desain belum aman.

### 35.2 Selalu Tanya “What If It Succeeds But We Don’t Know?”

Ini ambiguity window paling penting.

Contoh:

- payment succeeded but response timeout;
- document issued but worker crashed;
- email sent but complete job failed;
- external agency updated but callback lost.

Butuh reconciliation, external reference, idempotency, dan audit.

### 35.3 Selalu Tanya “Who Owns the Truth?”

- domain DB owns business facts;
- Camunda owns execution state;
- audit store owns evidence trail;
- external system owns external transaction result;
- search/read model owns query convenience.

Jangan campur.

### 35.4 Selalu Tanya “Can We Repair This Safely?”

Untuk setiap stuck state:

- apa diagnosisnya?
- siapa boleh repair?
- repair via API apa?
- apa before/after?
- apakah retry safe?
- apakah business owner perlu approve?
- apakah customer/user terdampak?

### 35.5 Selalu Tanya “Can We Explain This Later?”

Jika sistem tidak bisa menjelaskan outcome, sistem belum cocok untuk proses kritikal/regulatori.

---

## 36. Ringkasan Inti

Anti-pattern BPMN/Camunda jarang muncul karena orang tidak tahu simbol BPMN. Anti-pattern muncul karena orang salah menempatkan responsibility.

Prinsip utama:

```text
BPMN coordinates business-significant flow.
Domain model owns business facts.
Worker executes idempotent side effects.
DMN owns explicit decision policy.
Messages connect asynchronous reality to process state.
Timers represent meaningful time-based transition.
Audit records accountability, not debug noise.
Operate/runbooks repair execution safely.
Versioning protects running instances from change shock.
```

Jika sebuah workflow:

- bisa retry tanpa duplicate side effect;
- bisa menerima duplicate/late/early message;
- bisa handle external timeout tanpa false business decision;
- bisa enforce human authorization di backend;
- bisa explain every decision;
- bisa repair incident tanpa corrupt state;
- bisa evolve process version without breaking old instances;
- bisa observed by business key and process key;
- bisa survive partial failure;

maka ia mulai mendekati production-grade process orchestration.

---

## 37. Latihan

### Latihan 1 — Audit Diagram Existing

Ambil satu BPMN existing. Tandai semua:

- service task;
- user task;
- gateway;
- timer;
- message event;
- variable write;
- external side effect;
- possible incident.

Untuk masing-masing, jawab:

```text
Apa failure mode-nya?
Apa retry behavior-nya?
Apa idempotency key-nya?
Apa audit event-nya?
Apa repair path-nya?
```

### Latihan 2 — Red Team a Worker

Ambil satu Java worker. Simulasikan:

1. crash sebelum side effect;
2. crash setelah side effect;
3. complete command timeout;
4. duplicate activation;
5. malformed variable;
6. external API returns 500;
7. external API returns business rejection;
8. external API timeout but side effect succeeded.

Tulis expected behavior untuk masing-masing.

### Latihan 3 — Build Review Scorecard

Gunakan scorecard Part 34 untuk satu process nyata. Jangan hanya beri skor; tulis bukti:

```text
Dimension: Worker idempotency
Score: 1
Evidence: payment worker has requestId but no dedup table, no stored external reference.
Action: introduce payment command table and provider idempotency key.
```

### Latihan 4 — Incident Runbook Draft

Pilih satu incident:

```text
Payment confirmation message did not correlate because process already timed out.
```

Buat runbook:

- detection;
- impact;
- safe diagnosis;
- data needed;
- repair options;
- approval needed;
- audit entry;
- post-repair validation.

---

## 38. Penutup Part 29

Part ini adalah jembatan dari “belajar Camunda” ke “mendesain workflow production-grade”.

Skill paling mahal bukan hafal elemen BPMN, tetapi mampu melihat:

```text
diagram -> runtime state -> failure window -> data contract -> side effect -> audit -> repair -> versioning -> operation
```

Dalam sistem enterprise/regulatory, process orchestration bukan hanya membuat proses berjalan. Ia harus membuat proses **benar, aman, bisa dijelaskan, bisa diperbaiki, dan bisa berevolusi**.

---

## Status Seri

Selesai:

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
- Part 29 — Anti-patterns, Failure Modes, and Design Review Checklist

Berikutnya:

- Part 30 — Capstone Architecture: End-to-End Regulatory Case Management with Java + Camunda

Seri belum selesai. Part berikutnya adalah bagian terakhir dari roadmap 31 part.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-28-workflow-engine-vs-state-machine-rules-engine-temporal.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-30-capstone-end-to-end-regulatory-case-management-java-camunda.md)

</div>