# learn-java-bpmn-camunda-process-orchestration-engineering

## Part 22 — Production Operations: Incidents, Repair, Migration, and Runbook Engineering

> Seri: `learn-java-bpmn-camunda-process-orchestration-engineering`  
> Part: `22 / 30`  
> Level: Advanced / Production Engineering  
> Fokus: operasi production workflow, incident handling, safe repair, migration, runbook, dan operational governance untuk Java + Camunda/BPMN systems.

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas:

- BPMN semantics.
- Camunda 7 vs Camunda 8.
- Zeebe runtime internals.
- Java client dan worker architecture.
- reliability, idempotency, retry, process variables.
- human workflow, DMN, message correlation, timers, parallelism, subprocess, saga.
- testing dan observability.

Bagian ini menjawab pertanyaan production yang sering jauh lebih sulit daripada implementasi awal:

> Ketika process instance sudah berjalan di production, lalu stuck, salah jalur, salah variable, worker gagal, external system bermasalah, model baru salah, atau ribuan instance terkena defect yang sama — bagaimana kita memperbaikinya tanpa merusak audit, consistency, dan kepercayaan bisnis?

Top 1% engineer tidak hanya bisa membuat BPMN model berjalan. Mereka bisa:

1. membaca kondisi runtime process instance,
2. membedakan technical failure dari business exception,
3. memilih tindakan repair yang tepat,
4. menjaga evidence dan audit trail,
5. menghindari repair yang menyembunyikan fakta bisnis,
6. membuat runbook yang bisa diikuti tim support,
7. melakukan migration dengan risiko terkendali,
8. mengubah production workflow tanpa membuat proses berjalan menjadi korban eksperimen.

---

## 1. Mental Model: Production Workflow adalah Sistem Hidup

CRUD API biasanya memiliki lifecycle pendek:

```text
request -> validate -> transaction -> response
```

Workflow production memiliki lifecycle panjang:

```text
start process
  -> wait for human
  -> call external system
  -> wait for message
  -> timer fires
  -> retry
  -> escalation
  -> decision
  -> compensation
  -> completion
```

Rentang waktunya bisa menit, hari, bulan, bahkan tahun. Artinya, ketika kita deploy versi baru hari ini, production masih bisa memiliki:

- instance lama di versi model lama,
- variable schema lama,
- worker behavior lama,
- external reference lama,
- SLA lama,
- task assignment lama,
- incident dari bug minggu lalu,
- message yang datang terlambat,
- process yang sudah melewati sebagian side effect.

Karena itu operasi workflow bukan sekadar restart service.

Operasi workflow adalah kemampuan menjaga invariant berikut:

```text
Business fact remains explainable.
Process state remains recoverable.
Side effect remains reconciliable.
Audit remains defensible.
User-visible outcome remains fair and controlled.
```

---

## 2. Production Operation Scope

Dalam sistem Camunda/BPMN, production operations mencakup beberapa lapisan.

| Layer | Contoh | Risiko |
|---|---|---|
| Engine/runtime | Zeebe broker, Camunda 7 engine, job executor | process stuck, incident, command rejection |
| Worker/application | Java worker, Spring Boot app | duplicate side effect, failed job, wrong variable |
| Data | process variables, domain DB, outbox/inbox | mismatch process-domain state |
| Human task | Tasklist/custom UI | wrong assignment, overdue task, unauthorized completion |
| Integration | REST/Kafka/RabbitMQ/email/payment | late message, duplicate callback, external outage |
| Model | BPMN/DMN/forms | wrong gateway, missing boundary event, bad version |
| Operations tooling | Operate/Cockpit/logs/metrics | blind repair, weak diagnosis |
| Governance | approval, audit, runbook | uncontrolled manual intervention |

A mature production workflow system has explicit policy for all layers.

---

## 3. Incident Taxonomy

Tidak semua “error” sama. Salah klasifikasi biasanya menyebabkan repair yang salah.

### 3.1 Technical incident

Contoh:

- worker cannot call external API,
- database timeout,
- malformed variable causes deserialization error,
- worker throws unhandled exception,
- job retries exhausted,
- connector failure,
- search store temporarily unavailable,
- job timeout due to slow dependency.

Technical incident biasanya berarti:

```text
Process wanted to continue, but technical execution failed.
```

Tindakan umum:

- fix dependency,
- fix variable,
- increase job retries,
- retry job,
- redeploy worker,
- mark incident resolved after root cause addressed.

### 3.2 Business exception

Contoh:

- applicant not eligible,
- payment rejected,
- document invalid,
- required agency rejects case,
- officer returns case for clarification.

Business exception bukan incident teknis. Ia harus dimodelkan sebagai BPMN path:

- BPMN error,
- boundary event,
- exclusive gateway,
- user task,
- escalation,
- compensation.

Business exception berarti:

```text
Process is functioning correctly, and the business outcome is negative/exceptional.
```

### 3.3 Modeling defect

Contoh:

- gateway expression salah,
- missing message catch event,
- timer terlalu pendek,
- call activity version binding salah,
- variable mapping hilang,
- compensation handler salah,
- subprocess tidak menangkap BPMN error.

Ini bukan sekadar runtime incident. Ini bug pada executable contract.

Tindakan mungkin:

- deploy fixed process model,
- migrate active instances,
- modify affected instances,
- cancel/restart selected instances,
- issue business communication,
- document correction reason.

### 3.4 Data defect

Contoh:

- process variable `riskScore` null,
- `caseId` salah,
- `agencyResponse` malformed,
- domain status tidak sinkron dengan process state,
- task completed with outdated data.

Data defect harus ditangani hati-hati karena memperbaiki data bisa berarti mengubah fakta.

Pertanyaan wajib:

```text
Apakah ini technical metadata yang aman dikoreksi,
atau business evidence yang harus dipertahankan sebagai historical fact?
```

### 3.5 Operational defect

Contoh:

- worker tidak deploy,
- secret expired,
- permission salah,
- disk/search store penuh,
- broker under-replicated,
- exporter lag,
- clock/timezone config salah,
- maintenance tanpa draining.

Tindakan:

- infra repair,
- scaling,
- restore credentials,
- replay/retry,
- runbook execution,
- post-incident review.

### 3.6 Human operation defect

Contoh:

- officer assigned to wrong team,
- task claimed by wrong user,
- maker and checker same person,
- supervisor approved wrong case,
- manual repair executed without approval.

Human defect biasanya perlu:

- audit entry,
- reversal/compensation,
- reassignment,
- management approval,
- policy clarification,
- user notification.

---

## 4. Incident vs Error vs Escalation vs Repair

Gunakan mental model berikut:

```text
Technical failure
  -> retry/backoff
  -> incident if exhausted

Business exception
  -> BPMN error / gateway / business path

Attention needed but process can continue
  -> escalation / notification / task assignment

State is wrong or stuck
  -> repair / modification / migration / cancellation
```

Kesalahan umum:

| Salah | Kenapa berbahaya |
|---|---|
| Semua exception dilempar sebagai incident | Business outcome jadi terlihat seperti technical failure |
| Semua failure dimodelkan sebagai BPMN error | Technical outage masuk ke business path |
| Semua stuck process di-cancel | Kehilangan history dan side effect context |
| Semua repair via DB update manual | Audit rusak, engine state bisa corrupt |
| Semua instance dimigrate tanpa selection criteria | Bisa memindahkan instance yang tidak kompatibel |

---

## 5. Camunda 8 Operational Reality

Camunda 8 berbeda dari Camunda 7 dalam cara diagnosis dan repair.

Camunda 8 memiliki orchestration cluster berbasis Zeebe. Operasi umumnya melihat:

- process definition,
- process instance,
- element instance,
- job,
- variable,
- incident,
- message subscription,
- user task,
- exported records/read model,
- worker behavior.

Operate digunakan untuk visibility dan troubleshooting process instances, incidents, variable inspection, retry/cancel/batch operation, process instance modification, dan migration sesuai capability versi yang digunakan.

Konsekuensi penting:

1. Engine state dan query/read model tidak selalu harus dipahami sebagai satu tabel seperti Camunda 7.
2. Worker adalah external application; tidak ada local DB transaction bersama engine.
3. Repair sering melibatkan kombinasi:
   - perbaiki worker/dependency,
   - perbaiki variable,
   - retry job,
   - resolve incident,
   - migrate/modify/cancel instance.
4. Idempotency dan reconciliation menjadi bagian operasi, bukan opsional.

---

## 6. Camunda 7 Operational Reality

Camunda 7 sering berjalan sebagai embedded/database-centric process engine.

Operasi melihat:

- runtime tables,
- job executor,
- failed jobs,
- incidents,
- execution tree,
- history tables,
- external tasks,
- Cockpit,
- process application deployment,
- database transaction boundary.

Kelebihan operasional Camunda 7:

- banyak state terlihat di relational DB,
- transaction boundary bisa dekat dengan aplikasi,
- Cockpit familiar untuk repair,
- migration API matang,
- embedded debugging lebih mudah untuk beberapa kasus.

Risiko operasional Camunda 7:

- DB menjadi bottleneck,
- job executor tuning kompleks,
- lock contention,
- history table growth,
- process engine sharing antar app bisa membuat blast radius besar,
- manual DB intervention sangat menggoda tetapi berbahaya.

Prinsipnya sama:

```text
Do not repair engine state directly through database unless it is an approved vendor-supported emergency path.
```

---

## 7. Diagnostic Workflow: Cara Membaca Incident

Ketika ada incident, jangan langsung retry.

Gunakan sequence diagnosis berikut.

### Step 1 — Identify scope

Tanyakan:

- Berapa instance terdampak?
- Satu process definition atau banyak?
- Satu worker type atau banyak?
- Satu tenant atau semua?
- Satu environment atau cross-environment?
- Terjadi setelah deployment tertentu?
- Terjadi setelah external outage?

Classification:

```text
single instance issue
batch issue
systemic issue
platform issue
model defect
integration outage
```

### Step 2 — Identify active element

Cari:

- process definition key/version,
- process instance key/id,
- active element id,
- job type,
- incident type,
- error message,
- variable snapshot,
- business key/correlation key,
- task/worker owner.

### Step 3 — Read process context

Jangan hanya baca error log. Baca posisi proses:

- Apa business step yang sedang dijalankan?
- Side effect apa yang mungkin sudah terjadi?
- Apakah process berada sebelum/selama/setelah human decision?
- Apakah ada timer aktif?
- Apakah ada message subscription aktif?
- Apakah ada child process aktif?
- Apakah ada compensation handler relevan?

### Step 4 — Read worker context

Cari:

- worker version,
- deployment timestamp,
- commit hash,
- retry count,
- exception class,
- timeout duration,
- external call trace id,
- idempotency key,
- outbox/inbox record,
- domain DB state.

### Step 5 — Determine side-effect state

Ini paling penting.

| Side-effect state | Meaning | Safe next action |
|---|---|---|
| Not attempted | Worker failed before external call | retry likely safe |
| Attempted, failed definitely | External returned failure | business/error path or retry depending classification |
| Attempted, success confirmed | External side effect done | do not repeat without idempotency |
| Attempted, outcome unknown | Timeout/network failure | reconcile before retry |
| Duplicate detected | Same command already processed | complete job idempotently |

### Step 6 — Choose action

Tindakan harus berdasarkan classification, bukan emosi.

Possible actions:

- wait,
- retry,
- update variable,
- resolve incident,
- reassign task,
- cancel instance,
- modify instance,
- migrate instance,
- compensate,
- restart process,
- apply batch operation,
- perform domain data correction,
- deploy worker fix,
- deploy BPMN fix.

---

## 8. Safe Repair Principle

Repair yang baik harus memenuhi lima syarat.

### 8.1 Explicit reason

Setiap repair harus menjawab:

```text
Why is this repair needed?
What is the observed symptom?
What is the root cause or best current hypothesis?
What invariant is being restored?
```

### 8.2 Minimal change

Jangan ubah lebih banyak dari yang diperlukan.

Contoh buruk:

```text
Cancel process and create new one manually.
```

Contoh lebih baik:

```text
Fix variable documentValidationResult from malformed string to expected JSON object,
increase job retries for element validate-documents,
then resolve incident and allow normal execution to continue.
```

### 8.3 Preserved audit

Repair harus meninggalkan jejak:

- who repaired,
- when,
- what changed,
- why changed,
- approval reference,
- before/after value,
- related incident ticket,
- business impact.

### 8.4 Business authorization

Beberapa repair teknis tidak membutuhkan business approval, misalnya retry after outage.

Tetapi repair yang mengubah outcome bisnis harus disetujui business owner.

Contoh butuh business approval:

- mengubah decision result,
- melewati approval task,
- mengubah eligibility flag,
- membatalkan enforcement process,
- mengulang payment step,
- menutup case manual.

### 8.5 Reversible or explainable

Tidak semua repair bisa rollback. Tetapi harus bisa dijelaskan.

```text
If not reversible, it must be strongly explainable.
```

---

## 9. Repair Action Matrix

| Problem | Preferred action | Avoid |
|---|---|---|
| External service outage, retries exhausted | Fix service, increase retries, retry/resolve incident | Cancel instance |
| Variable malformed but business fact known | Correct variable with audit, retry job | Direct DB patch without trace |
| Worker bug, no side effect done | Deploy fix, retry | Modify process path unnecessarily |
| Worker bug, side effect already done | Reconcile, complete idempotently or move forward | Repeat side effect blindly |
| Wrong user assigned | Reassign task with audit | Complete task on behalf silently |
| Wrong gateway expression deployed | Deploy fixed model, migrate/modify affected instances | Let all instances continue wrong path |
| Missing boundary error | Deploy model fix, migrate compatible instances | Catch errors in worker only and hide process state |
| Process stuck at obsolete task | Migration or controlled modification | Manual DB delete execution |
| Duplicate external callback | Deduplicate by event ID/correlation key | Start duplicate process |
| Late message after timeout | Route to reconciliation or ignore with audit | Correlate to wrong/new instance |

---

## 10. Incident Resolution in Camunda 8

For job-related incidents, typical sequence:

```text
1. Find incident in Operate/API.
2. Inspect process instance and active element.
3. Inspect job failure reason.
4. Inspect variables relevant to failure.
5. Fix root cause:
   - worker bug,
   - dependency outage,
   - data issue,
   - variable shape,
   - configuration.
6. If needed, update variables.
7. Increase remaining retries for job.
8. Resolve incident.
9. Observe process continuation.
10. Record repair note/ticket/audit.
```

Do not simply mark incident resolved without making the job executable again. For job-related incidents, resolving often requires resetting/increasing retries first.

### 10.1 Variable correction example

Problem:

```json
{
  "caseId": "CASE-123",
  "riskScore": "HIGH"
}
```

Worker expected:

```json
{
  "caseId": "CASE-123",
  "riskScore": 87,
  "riskBand": "HIGH"
}
```

Safe repair:

```text
- Confirm source of truth in domain DB.
- Confirm no business decision has been made from wrong value.
- Update process variable to expected shape.
- Record before/after in audit repair log.
- Retry/resolve incident.
```

Unsafe repair:

```text
- Set riskScore = 0 just to pass worker.
```

### 10.2 Worker fix example

Problem:

- `generate-license-document` worker fails because PDF template key renamed.

Safe repair:

```text
- Deploy worker/config fix.
- Verify template exists.
- Retry affected incidents in batch.
- Monitor document generation success.
- Check duplicate document generation idempotency.
```

---

## 11. Process Instance Modification

Process instance modification means changing the current execution position of an active process instance.

Examples:

- skip an activity,
- repeat an activity,
- move token to another activity,
- terminate active element,
- activate another element.

This is powerful and dangerous.

Use only for exceptional repair, not regular business flow.

Good use cases:

- process stuck due to modeling defect,
- wrong service task should be skipped after manual verification,
- need to repeat task after technical correction,
- need to move instance past obsolete element after approved fix.

Bad use cases:

- normal approval shortcut,
- business override that should be modeled,
- frequent manual routing,
- replacing proper exception path,
- hiding a failed decision.

### 11.1 Modification decision checklist

Before modifying:

```text
[ ] Is this exceptional?
[ ] Why was this not modeled?
[ ] What active elements exist?
[ ] What timers/messages/tasks will be affected?
[ ] What side effects already happened?
[ ] Will modification skip audit-relevant human decision?
[ ] Is business approval required?
[ ] Is variable state compatible with target activity?
[ ] Is there a rollback/compensation plan?
[ ] Is the modification recorded?
```

### 11.2 Example: skip broken notification step

Scenario:

- License application approved.
- Process stuck at `send-approval-email`.
- Email service broken.
- Business confirms email can be resent manually outside process.
- Process should continue to license issuance.

Options:

1. Retry after fixing email service.
2. Complete job idempotently if email already sent.
3. Modify instance to skip email step.

Best choice usually:

```text
Fix email service and retry,
unless there is urgent business need and approved manual notification evidence.
```

If modifying, record:

- why notification was skipped,
- who approved,
- how applicant was notified,
- evidence link,
- instance key,
- target activity.

---

## 12. Process Instance Migration

Migration means moving active/running process instances from one process definition version to another.

This is different from modification.

```text
Modification changes where one instance is executing.
Migration changes which model version an instance follows.
```

Use migration when:

- new model fixes a defect affecting running instances,
- new version adds future steps that old instances should follow,
- long-running cases must adopt new regulatory process,
- old process version cannot continue safely.

Do not use migration when:

- running instances are already too far along,
- variable contract incompatible,
- active element changed in unsupported way,
- business policy should only apply to new applications,
- migration would rewrite historical decision path.

### 12.1 Migration compatibility

Check:

| Area | Question |
|---|---|
| Active element | Can current active element map to target model? |
| Future path | Are added/removed steps safe for current instance? |
| Variables | Does target model expect new variables? |
| Workers | Are job types compatible? |
| User tasks | Are assignments/forms compatible? |
| Timers | Are due dates recalculated or preserved? |
| Messages | Are subscriptions compatible? |
| Call activities | Are child processes affected? |
| DMN | Are decision versions compatible? |
| Audit | Is migration reason recorded? |

### 12.2 Migration strategy

A safe migration typically follows:

```text
1. Identify affected process definition version(s).
2. Classify active instance positions.
3. Group instances by active element and variable shape.
4. Define migration plan per group.
5. Test migration in lower environment using production-like snapshots.
6. Validate post-migration path.
7. Obtain approval if business behavior changes.
8. Execute small batch first.
9. Monitor incidents and business metrics.
10. Execute remaining batches.
11. Keep rollback/contingency plan.
12. Document migration result.
```

### 12.3 Migration grouping example

Bad:

```text
Migrate all 20,000 instances from v3 to v4.
```

Good:

```text
Group A: 5,000 waiting at Officer Review
Group B: 9,000 waiting at Agency Response
Group C: 3,000 at Payment Pending
Group D: 2,000 completed or near completion — do not migrate
Group E: 1,000 incident — repair first, then evaluate
```

---

## 13. Cancel, Restart, Modify, Migrate, or Retry?

Use this decision matrix.

```text
Is the process state still valid?
  yes -> can retry/repair in place
  no  -> consider modify/migrate/cancel/restart

Was business side effect already done?
  no  -> retry/modify may be safe
  yes -> reconcile before repeating

Is model defective?
  no  -> retry/repair data/dependency
  yes -> deploy fix + migrate/modify affected instances

Is active path legally/business invalid?
  yes -> stop/cancel/compensate with approval
  no  -> prefer least invasive repair

Can historical path remain true?
  yes -> migrate future path only
  no  -> do not rewrite; create corrective process/audit note
```

### Retry

Use when:

- transient technical problem,
- worker fixed,
- dependency restored,
- data corrected,
- no unsafe duplicate side effect.

### Modify

Use when:

- one/few instances need exceptional token correction,
- model path is locally wrong,
- business approves exceptional transition.

### Migrate

Use when:

- many running instances should continue under new process version,
- old model has defect or policy changed for active cases,
- compatibility is tested.

### Cancel

Use when:

- process should no longer exist,
- duplicate process created,
- business case withdrawn,
- process is irrecoverably invalid.

### Restart

Use when:

- old instance cannot be safely repaired,
- new process must start with clean state,
- historical old instance remains as evidence,
- domain state can reference replacement process.

---

## 14. Batch Operations

Batch operations are useful when many instances are affected by same root cause.

Examples:

- retry all incidents caused by external outage,
- cancel duplicate process instances,
- migrate selected instances,
- apply operation to process instances matching criteria.

Batch operations need stronger controls than single-instance repair.

### 14.1 Batch operation checklist

```text
[ ] What exact population is affected?
[ ] What query selects the population?
[ ] How many instances?
[ ] Are there exclusions?
[ ] Has selection been reviewed?
[ ] Is there a sample validation?
[ ] Is there business approval?
[ ] Is operation idempotent?
[ ] What metrics confirm success?
[ ] What is the rollback/contingency?
[ ] Who executes and who observes?
```

### 14.2 Batch retry after outage

Scenario:

- External document service down for 2 hours.
- 3,500 `generate-document` jobs exhausted retries.
- Service restored.

Safe plan:

```text
1. Confirm external service stable.
2. Confirm worker idempotency for document generation.
3. Query incidents by job type and time window.
4. Exclude instances manually repaired/cancelled.
5. Retry 20 sample instances.
6. Validate no duplicates.
7. Execute batch retry in chunks.
8. Monitor worker throughput, external API rate, incident count.
9. Produce incident closure report.
```

---

## 15. Runbook Engineering

A runbook is not a wiki page full of vague advice. A good runbook is an executable decision aid.

It should tell operators:

- how to identify symptom,
- how to classify severity,
- what data to collect,
- which action is safe,
- which action requires approval,
- how to validate success,
- how to escalate.

### 15.1 Runbook structure

Use this template:

```markdown
# Runbook: <Incident Type>

## Purpose
What this runbook solves.

## Symptoms
Observable signs.

## Severity
SEV criteria.

## Preconditions
What must be true before executing repair.

## Diagnosis Steps
Step-by-step evidence collection.

## Decision Tree
Which repair path to choose.

## Repair Steps
Exact commands/UI actions/API calls.

## Validation
How to confirm fix.

## Rollback/Contingency
What to do if repair fails.

## Audit Requirements
What must be recorded.

## Escalation
Who to contact and when.

## Known Risks
Duplicate side effect, skipped task, data mismatch, etc.
```

### 15.2 Example runbook: job retries exhausted

```markdown
# Runbook: Camunda Job Incident - Retries Exhausted

## Symptoms
- Incident visible in Operate.
- Active element is service task.
- Error message indicates worker failure.

## Diagnosis
1. Capture processInstanceKey, processDefinitionId, version, elementId, jobType.
2. Read worker logs using correlation fields.
3. Check whether external side effect was attempted.
4. Check idempotency table/outbox/inbox.
5. Classify failure as transient, data defect, worker bug, or business error.

## Repair
- Transient outage: restore dependency, increase retries, resolve incident.
- Data defect: correct variable with audit, increase retries, resolve incident.
- Worker bug: deploy fix, retry sample, batch retry.
- Business error: do not retry as technical incident; route to modeled business path.

## Validation
- Incident count decreases.
- Process instance moves to expected next element.
- No duplicate side effects.
- Audit note created.
```

---

## 16. Severity Model for Workflow Incidents

A workflow incident severity model should include business impact, not only technical availability.

| Severity | Definition | Example |
|---|---|---|
| SEV1 | Broad business outage, legal/regulatory deadline risk, mass incorrect outcome | all license issuance stuck before statutory deadline |
| SEV2 | Major process path affected, workaround exists but costly | payment confirmation stuck for many cases |
| SEV3 | Limited subset, no deadline risk | 20 cases stuck due to malformed variable |
| SEV4 | Single instance, no user impact | one duplicate callback ignored |

Severity should consider:

- number of instances,
- affected business capability,
- SLA/deadline,
- financial/legal impact,
- user/customer impact,
- data correctness risk,
- manual workaround cost,
- audit/regulatory exposure.

---

## 17. Operational Ownership Model

For production workflow, define ownership clearly.

| Action | Typical owner | Approval needed? |
|---|---|---|
| Retry failed job after outage | Tech ops / application support | usually no, if no side effect risk |
| Update technical variable shape | App support + tech lead | yes for tracked repair |
| Change business decision variable | Business owner + tech lead | yes, strong audit |
| Reassign user task | Business supervisor | depends on policy |
| Cancel process instance | Business owner | yes |
| Modify process token | Tech lead + business owner | yes |
| Migrate batch of instances | Tech lead + product/business owner | yes |
| Deploy BPMN fix | Engineering + release manager | change approval |
| Manual DB repair | DBA + tech lead + vendor guidance | emergency only |

---

## 18. Audit-safe Repair Log

Do not rely only on engine history. Create an application-level repair log for regulated systems.

Example schema:

```sql
CREATE TABLE workflow_repair_log (
    id                      VARCHAR(64) PRIMARY KEY,
    process_instance_key     VARCHAR(128) NOT NULL,
    process_definition_id    VARCHAR(255),
    process_definition_ver   INTEGER,
    business_key             VARCHAR(255),
    case_id                  VARCHAR(255),
    repair_type              VARCHAR(64) NOT NULL,
    severity                 VARCHAR(16),
    reason_code              VARCHAR(64) NOT NULL,
    reason_text              CLOB NOT NULL,
    before_snapshot          CLOB,
    after_snapshot           CLOB,
    approval_ref             VARCHAR(255),
    incident_ref             VARCHAR(255),
    executed_by              VARCHAR(255) NOT NULL,
    executed_at              TIMESTAMP NOT NULL,
    validated_by             VARCHAR(255),
    validated_at             TIMESTAMP,
    outcome                  VARCHAR(64) NOT NULL
);
```

Repair types:

- `RETRY_JOB`,
- `UPDATE_VARIABLE`,
- `RESOLVE_INCIDENT`,
- `MODIFY_INSTANCE`,
- `MIGRATE_INSTANCE`,
- `CANCEL_INSTANCE`,
- `REASSIGN_TASK`,
- `MANUAL_COMPENSATION`,
- `RECONCILIATION`,
- `BATCH_OPERATION`.

Important:

```text
Repair log is not a replacement for engine history.
It is an explicit governance layer around exceptional operational actions.
```

---

## 19. Reconciliation Engineering

Many workflow incidents cannot be safely repaired until external side-effect state is known.

Examples:

- payment request timed out,
- email send timed out,
- document generation timed out,
- external agency callback missing,
- license issuance API returned 500 but actually committed,
- Kafka message published but completion failed.

Reconciliation answers:

```text
What actually happened outside the engine?
```

### 19.1 Reconciliation table

```sql
CREATE TABLE external_operation_reconciliation (
    operation_id          VARCHAR(128) PRIMARY KEY,
    process_instance_key  VARCHAR(128) NOT NULL,
    business_key          VARCHAR(255) NOT NULL,
    operation_type        VARCHAR(64) NOT NULL,
    external_ref          VARCHAR(255),
    requested_at          TIMESTAMP NOT NULL,
    last_checked_at       TIMESTAMP,
    external_status       VARCHAR(64),
    internal_status       VARCHAR(64) NOT NULL,
    reconciliation_status VARCHAR(64) NOT NULL,
    decision              VARCHAR(64),
    decision_reason       CLOB
);
```

### 19.2 Worker behavior with reconciliation

```java
public CompletionDecision handle(DocumentGenerationJob job) {
    OperationId opId = OperationId.from(job.processInstanceKey(), job.elementInstanceKey());

    Optional<ExternalOperation> existing = operationRepository.find(opId);

    if (existing.isPresent() && existing.get().isConfirmedSuccess()) {
        return CompletionDecision.complete(Map.of(
            "documentId", existing.get().externalRef(),
            "documentGenerated", true
        ));
    }

    if (existing.isPresent() && existing.get().isOutcomeUnknown()) {
        return CompletionDecision.failWithBackoff(
            "External document generation outcome unknown; reconciliation required",
            0
        );
    }

    ExternalOperationResult result = documentClient.generate(job.caseId(), opId.value());

    operationRepository.saveFromResult(opId, result);

    if (result.isSuccess()) {
        return CompletionDecision.complete(Map.of("documentId", result.documentId()));
    }

    if (result.isBusinessRejected()) {
        return CompletionDecision.throwBpmnError("DOCUMENT_REJECTED", result.reason());
    }

    return CompletionDecision.failWithRetry(result.errorMessage());
}
```

---

## 20. Deployment Failure and Rollback Reality

Workflow rollback is harder than API rollback.

API rollback:

```text
Deploy v2 -> error -> rollback to v1
```

Workflow rollback:

```text
Deploy process v4
new instances start on v4
some workers execute side effects
some process instances wait at new user task
some variables use new schema
then defect found
```

Rolling back code does not automatically roll back:

- process definitions already deployed,
- process instances already started,
- human tasks already created,
- side effects already done,
- variable schema already written,
- messages already correlated,
- timers already scheduled.

Therefore release strategy must include:

- process definition versioning,
- worker backward compatibility,
- feature flagging,
- canary start,
- migration plan,
- rollback plan,
- repair plan for instances already affected.

---

## 21. Production Deployment Strategy for BPMN

### 21.1 Safe deployment sequence

```text
1. Deploy backward-compatible worker first.
2. Deploy process model new version.
3. Start only canary cases on new version.
4. Observe process path, variables, user tasks, jobs.
5. Enable more traffic.
6. Keep old worker compatibility until old instances drain or migrate.
7. Migrate only after explicit decision.
```

### 21.2 Worker compatibility rule

A worker should often support multiple process versions.

Bad:

```java
String riskBand = variables.get("riskBand"); // assumes new model only
```

Better:

```java
String riskBand = variables.containsKey("riskBand")
        ? variables.get("riskBand")
        : deriveRiskBandFromLegacyRiskScore(variables.get("riskScore"));
```

But do not let compatibility logic grow forever. Define sunset policy.

### 21.3 Version-aware variable contract

Include process contract version:

```json
{
  "caseId": "CASE-2026-0001",
  "processContractVersion": 3,
  "risk": {
    "score": 82,
    "band": "HIGH"
  }
}
```

---

## 22. Common Production Failure Modes

### 22.1 Retry storm

Cause:

- external service down,
- thousands of jobs retry quickly,
- worker and external service overload each other.

Mitigation:

- exponential backoff,
- circuit breaker,
- rate limit,
- worker max jobs active tuning,
- pause traffic if supported by deployment strategy,
- incident batch retry after recovery.

### 22.2 Duplicate side effect

Cause:

- job timeout,
- worker completed external call,
- worker crashed before completing job,
- job reactivated and processed by another worker.

Mitigation:

- idempotency key,
- outbox/inbox,
- external operation table,
- reconciliation before retry.

### 22.3 Variable schema drift

Cause:

- model/worker changed variable shape,
- old instances still active,
- new worker assumes new schema.

Mitigation:

- versioned variable contract,
- backward-compatible worker,
- migration script,
- process version selection.

### 22.4 Timer flood

Cause:

- many timer events fire at same time,
- reminder batch poorly modeled,
- bulk process started with identical SLA dates.

Mitigation:

- stagger timers,
- external scheduling service for massive reminders,
- rate limit downstream side effects,
- model reminders as batch jobs where appropriate.

### 22.5 Message correlation miss

Cause:

- wrong correlation key,
- message arrives before subscription and TTL is zero/expired,
- process already timed out,
- duplicate process instance.

Mitigation:

- inbound event table,
- message TTL policy,
- correlation key tests,
- late event handling,
- reconciliation queue.

### 22.6 Operate/read model lag mistaken as engine failure

Cause:

- exporter/search store delay,
- UI not yet showing latest state.

Mitigation:

- distinguish command outcome from exported read model,
- check metrics/logs,
- avoid repeated manual repair based only on UI lag.

### 22.7 Manual repair creates inconsistency

Cause:

- operator updates variable without domain DB alignment,
- process moved past validation step,
- human task completed by admin without decision evidence.

Mitigation:

- repair approval workflow,
- repair log,
- validation checklist,
- strict authorization.

---

## 23. Runbook: Stuck Process Instance

```markdown
# Runbook: Stuck Process Instance

## Symptoms
- Instance remains at same BPMN element longer than expected.
- SLA breached or about to breach.
- No visible incident, or incident exists but unclear.

## Diagnosis
1. Identify process instance key and business key.
2. Identify active element(s).
3. Check if active element is expected wait state:
   - user task,
   - message catch,
   - timer,
   - service task incident,
   - call activity,
   - multi-instance join.
4. Check whether waiting condition is satisfied:
   - user task completed?
   - message received?
   - timer due?
   - job activated?
   - child process complete?
5. Check worker health and job metrics.
6. Check process variables needed by current element.
7. Check external events/callback table.
8. Classify as expected wait, technical incident, data defect, model defect, or external dependency issue.

## Repair Decision
- Expected wait: no repair; notify business if SLA risk.
- Missing message: investigate inbound event/correlation.
- Failed job: follow job incident runbook.
- Wrong variable: variable correction runbook.
- Model defect: consider modification/migration.
- Duplicate/obsolete instance: consider cancellation.

## Validation
- Instance moves to expected next state or remains intentionally waiting.
- Audit note created if manual action performed.
```

---

## 24. Runbook: Wrong Task Assignment

```markdown
# Runbook: Wrong User Task Assignment

## Symptoms
- Task visible to wrong group/user.
- Authorized user cannot see task.
- Maker/checker violation risk.

## Diagnosis
1. Identify task key/id, process instance, element id.
2. Inspect assignment variables.
3. Inspect identity/group mapping.
4. Determine whether issue is data, BPMN expression, IAM, or UI query.
5. Check whether task has been claimed or completed.

## Repair
- If not completed: reassign/unclaim/update candidate group according to policy.
- If completed by wrong actor: escalate to business owner; determine whether decision must be reversed, repeated, or accepted with exception note.
- If BPMN expression defect: deploy model fix; evaluate active instances.

## Audit
Record old assignee/group, new assignee/group, reason, approval, executor.
```

---

## 25. Runbook: Message Correlation Failure

```markdown
# Runbook: Message Correlation Failure

## Symptoms
- External event received but process did not continue.
- Message publish returns no correlation or rejection.
- Process waiting at message catch event.

## Diagnosis
1. Capture eventId, messageName, correlationKey, businessKey.
2. Verify process instance is waiting for expected message.
3. Verify correlation key generated by model equals event key.
4. Check message TTL and timing.
5. Check if process timed out/cancelled/completed.
6. Check duplicate event table.
7. Check if wrong process version expects different message name.

## Repair
- If process still waiting and event valid: republish message with correct name/key.
- If event arrived too early and TTL expired: replay from inbound event table if valid.
- If process timed out: route event to late-event reconciliation.
- If duplicate: mark ignored with reference to original.
- If model defect: deploy fix and evaluate migration/modification.

## Validation
- Process moves past message event or late-event reconciliation record exists.
```

---

## 26. Runbook: Process Migration

```markdown
# Runbook: Process Instance Migration

## Preconditions
- New process definition deployed and tested.
- Migration plan reviewed.
- Affected instance population identified.
- Business approval obtained if behavior changes.

## Diagnosis/Preparation
1. Export candidate instance list.
2. Group by active element.
3. Validate variable compatibility.
4. Validate user task/form compatibility.
5. Validate message/timer/call activity compatibility.
6. Test migration on lower environment.
7. Define rollback/contingency.

## Execution
1. Migrate small sample batch.
2. Validate process state and metrics.
3. Migrate remaining batches by group.
4. Monitor incidents.
5. Produce migration report.

## Audit
Record source definition/version, target definition/version, population query, approval, operator, timestamp, result summary.
```

---

## 27. API/Tooling Boundary

Production operations may use:

- Operate UI,
- Orchestration Cluster API,
- application admin backend,
- custom support console,
- database read-only queries,
- logs/metrics/traces,
- ticketing system,
- audit repair log.

Avoid giving broad direct access to raw engine operations.

A safer model:

```text
Operator action -> Support Backend -> Policy Check -> Camunda API -> Repair Log -> Validation
```

Instead of:

```text
Operator -> direct DB/API unrestricted repair
```

### 27.1 Support backend pattern

Create internal support endpoints:

```text
POST /admin/workflow/instances/{id}/retry-job
POST /admin/workflow/instances/{id}/repair-variable
POST /admin/workflow/instances/{id}/reassign-task
POST /admin/workflow/instances/{id}/cancel
POST /admin/workflow/migrations/{planId}/execute
```

Each endpoint enforces:

- role check,
- approval check,
- reason code,
- before/after snapshot,
- repair log,
- Camunda API call,
- post-validation,
- audit event.

---

## 28. Java Support Service Sketch

```java
public final class WorkflowRepairService {

    private final CamundaClient camundaClient;
    private final RepairLogRepository repairLogRepository;
    private final DomainCaseRepository caseRepository;
    private final ApprovalPolicy approvalPolicy;

    public void repairVariable(RepairVariableCommand command) {
        approvalPolicy.requireAllowed(
                command.operator(),
                RepairType.UPDATE_VARIABLE,
                command.approvalRef()
        );

        ProcessContext ctx = loadProcessContext(command.processInstanceKey());
        DomainCase domainCase = caseRepository.findByBusinessKey(ctx.businessKey())
                .orElseThrow();

        VariableSnapshot before = readVariables(command.processInstanceKey());

        validateVariableRepair(command, ctx, domainCase, before);

        camundaClient
                .newSetVariablesCommand(command.processInstanceKey())
                .variables(command.newVariables())
                .send()
                .join();

        VariableSnapshot after = readVariables(command.processInstanceKey());

        repairLogRepository.save(RepairLogEntry.builder()
                .processInstanceKey(command.processInstanceKey())
                .businessKey(ctx.businessKey())
                .repairType(RepairType.UPDATE_VARIABLE)
                .reasonCode(command.reasonCode())
                .reasonText(command.reasonText())
                .approvalRef(command.approvalRef())
                .beforeSnapshot(before.toJson())
                .afterSnapshot(after.toJson())
                .executedBy(command.operator())
                .outcome("VARIABLE_UPDATED")
                .build());
    }

    private void validateVariableRepair(
            RepairVariableCommand command,
            ProcessContext ctx,
            DomainCase domainCase,
            VariableSnapshot before
    ) {
        if (command.newVariables().containsKey("decisionOutcome")) {
            throw new IllegalArgumentException(
                    "decisionOutcome cannot be changed through technical variable repair"
            );
        }

        if (domainCase.isClosed()) {
            throw new IllegalStateException("Cannot repair variable for closed case without special approval");
        }
    }
}
```

Key idea:

```text
Do not expose raw repair primitives without business policy guardrails.
```

---

## 29. Backup and Restore

Backup/restore belongs to disaster recovery, not normal incident repair.

Use restore for:

- data loss,
- corruption,
- catastrophic environment failure,
- unrecoverable platform failure.

Do not use restore for:

- one wrong variable,
- one failed worker,
- normal incident,
- business correction,
- one bad process path.

Why?

A restore changes platform state at broad scope and may conflict with:

- external side effects already sent,
- user actions after backup time,
- messages/events after backup time,
- domain DB state,
- downstream systems.

Restore planning must include:

- RPO/RTO,
- backup version compatibility,
- engine state,
- search/read model state,
- domain DB backup alignment,
- external message replay strategy,
- post-restore reconciliation.

---

## 30. Post-Incident Review for Workflow Systems

A workflow postmortem should include process-specific questions.

### 30.1 Technical timeline

- When did first failure occur?
- When was it detected?
- Which process definition/version?
- Which worker version?
- Which external dependency?
- How many instances affected?
- Which business stages affected?

### 30.2 Process correctness

- Did BPMN model contain expected error path?
- Was the incident truly technical or business?
- Were retries/backoff appropriate?
- Were timers/SLA impacted?
- Did any instance take wrong path?
- Were any human tasks incorrectly assigned/completed?

### 30.3 Side-effect analysis

- Were duplicate side effects created?
- Were external systems updated?
- Was reconciliation needed?
- Was compensation needed?
- Were user notifications sent incorrectly?

### 30.4 Operational effectiveness

- Did alerts fire?
- Did logs include correlation IDs?
- Was Operate enough to diagnose?
- Did runbook exist?
- Were repair actions approved?
- Was audit complete?

### 30.5 Preventive actions

- model change,
- worker idempotency improvement,
- better retry/backoff,
- additional boundary event,
- stronger validation,
- better dashboard,
- runbook update,
- test scenario added,
- release checklist update.

---

## 31. Production Readiness Checklist

### Incident readiness

```text
[ ] Incident taxonomy defined.
[ ] Severity model defined.
[ ] Ownership defined.
[ ] Operate/Cockpit access controlled.
[ ] Logs include process identifiers.
[ ] Metrics include job failures and process SLA.
[ ] Runbooks exist for common failures.
```

### Repair readiness

```text
[ ] Repair log exists.
[ ] Variable repair policy exists.
[ ] Task reassignment policy exists.
[ ] Cancel/modify/migrate policy exists.
[ ] Approval model exists.
[ ] Support backend validates repair actions.
[ ] Manual DB repair is restricted/emergency-only.
```

### Migration readiness

```text
[ ] Process versioning strategy exists.
[ ] Worker backward compatibility policy exists.
[ ] Variable schema versioning exists.
[ ] Migration grouping approach exists.
[ ] Migration tested in lower environment.
[ ] Batch operation controls exist.
```

### Reconciliation readiness

```text
[ ] External operations have idempotency keys.
[ ] Outcome unknown state is modeled.
[ ] Reconciliation table/process exists.
[ ] Duplicate callback handling exists.
[ ] Late event handling exists.
```

### Audit readiness

```text
[ ] Repair actions require reason code.
[ ] Before/after snapshots are stored.
[ ] Business approval reference can be stored.
[ ] Human task actions are audited.
[ ] Process repair can be explained later.
```

---

## 32. Top 1% Engineering Heuristics

### 32.1 Never retry what you do not understand

Retry can fix transient failure, but it can also duplicate side effects.

Before retry:

```text
Was external side effect attempted?
Is idempotency guaranteed?
Is failure transient or deterministic?
```

### 32.2 Do not use incident as business path

If a condition is expected by business, model it.

```text
Expected rejection -> BPMN path.
Unexpected technical failure -> incident/retry.
```

### 32.3 Do not use process modification as hidden feature flag

If operators regularly modify instances to support business needs, your model is incomplete.

### 32.4 Prefer future correction over history rewrite

Do not pretend a wrong historical event never happened.

Better:

```text
Record wrong event -> corrective action -> explain final state.
```

### 32.5 Process state and domain state must reconcile

Engine says where process is.
Domain DB says what business entity is.
Audit says why it happened.

Production support must be able to align all three.

### 32.6 Repair is product behavior

Manual repair is not outside the product. In regulated systems, repair behavior is part of the product’s trust boundary.

---

## 33. Worked Example: Regulatory Application Stuck After Agency Review

### Context

Process:

```text
Submit Application
  -> Validate Documents
  -> Risk Assessment
  -> Agency Review
  -> Officer Decision
  -> Issue License
```

Current incident:

- 800 applications stuck after external agency response.
- Worker `process-agency-response` fails.
- Error: `Cannot deserialize field agencyDecision.effectiveDate`.
- External agency already sent responses.

### Bad response

```text
Retry all jobs immediately.
```

Why bad?

- Same malformed payload will fail again.
- Could create retry storm.
- Does not understand whether responses are valid.

### Good response

Step 1 — Scope:

```text
Affected: process-agency-response jobs
Count: 800
Time: after agency schema change
Process versions: v12 and v13
```

Step 2 — Root cause:

```text
Agency changed effectiveDate from yyyy-MM-dd to ISO timestamp.
Worker parser only accepts LocalDate.
```

Step 3 — Side effect:

```text
Agency response already received.
No outbound side effect from failing worker yet.
```

Step 4 — Fix:

```text
Deploy worker parser supporting both LocalDate and OffsetDateTime.
Add contract test.
```

Step 5 — Repair:

```text
Retry sample 10 incidents.
Validate process moves to Officer Decision.
Batch retry remaining incidents in chunks.
```

Step 6 — Audit:

```text
Create incident report.
Record batch operation query.
Record worker version fix.
Record no business decision was altered.
```

Step 7 — Prevention:

```text
Add agency response schema validation at ingestion.
Add compatibility parser.
Add external schema change monitoring.
Add alert on deserialization incident count.
```

---

## 34. Worked Example: Wrong BPMN Gateway Sends Low-risk Case to Senior Approval

### Context

A new process version v18 has gateway:

```text
if riskBand = "LOW" -> Senior Approval
else -> Standard Approval
```

It should be reversed:

```text
if riskBand = "HIGH" -> Senior Approval
else -> Standard Approval
```

100 cases affected.

### Classification

This is modeling defect, not worker incident.

### Repair plan

1. Deploy v19 with corrected gateway.
2. Identify v18 instances:
   - already completed senior approval,
   - waiting at senior approval,
   - before gateway,
   - after standard approval.
3. Decide per group:

| Group | Action |
|---|---|
| Before gateway | migrate to v19 if compatible |
| Waiting wrongly at Senior Approval | modify/migrate to Standard Approval only if business approves |
| Already senior approved | may accept as stricter path; no correction needed unless SLA impact |
| Incorrectly skipped senior approval for high risk | urgent business correction; route to senior review corrective task |

4. Record decision.
5. Add gateway test case.

Key principle:

```text
Not every wrong route should be erased.
Some should be corrected forward with explicit evidence.
```

---

## 35. Summary

Production workflow operations require a different level of discipline from normal service operations.

You must think in terms of:

- process instance state,
- business entity state,
- side-effect state,
- human decision state,
- audit state,
- model version state,
- worker version state,
- external event state.

The most important distinctions:

```text
Technical failure != business exception.
Retry != repair.
Repair != history rewrite.
Migration != modification.
Cancellation != compensation.
Engine state != domain truth.
Operate visibility != complete audit.
```

A top-tier workflow engineer does not merely ask:

```text
How do I make this incident disappear?
```

They ask:

```text
What actually happened?
What is the safest minimal correction?
What must remain explainable two years from now?
Which invariant are we restoring?
How do we prevent this class of failure from recurring?
```

---

## 36. Referensi Belajar Lanjutan

Gunakan referensi resmi terbaru ketika mengoperasikan production system karena fitur Operate, migration, modification, backup/restore, dan API dapat berubah antar versi Camunda 8.

Topik yang perlu dibaca:

- Camunda 8 incidents.
- Operate process instance modification.
- Operate process instance migration.
- Operate batch operations.
- Orchestration Cluster API incident resolution.
- Camunda 8 backup and restore.
- Camunda 7 Cockpit and incident operations.
- Process instance migration limitations.
- Worker retry/backoff and job timeout.

---

## 37. Apa yang Akan Dibahas di Part 23

Part berikutnya:

# Part 23 — Security, Identity, Authorization, and Data Protection

Kita akan membahas:

- platform identity,
- application identity,
- worker credentials,
- task authorization,
- tenant isolation,
- process start authorization,
- variable sensitivity,
- PII minimization,
- secret leakage prevention,
- privileged operation governance,
- threat modeling workflow systems,
- unauthorized task completion,
- process manipulation,
- variable tampering,
- replayed message,
- worker impersonation.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 21 — Observability: Logs, Metrics, Tracing, Audit, and Operability](./learn-java-bpmn-camunda-part-21-observability-logs-metrics-tracing-audit-operability.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 23 — Security, Identity, Authorization, and Data Protection](./learn-java-bpmn-camunda-part-23-security-identity-authorization-data-protection.md)
