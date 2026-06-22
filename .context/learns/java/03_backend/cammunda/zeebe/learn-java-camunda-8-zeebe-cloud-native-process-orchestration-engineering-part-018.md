# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-018.md

# Part 018 — Operate Deep Dive: Incident Triage, Process Instance Debugging, and Production Support

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Bagian: `018`  
> Level: Advanced / Production Engineering  
> Fokus: Operate sebagai cockpit operasional untuk proses Zeebe: debugging, incident triage, variable repair, retry, cancellation, modification, batch operation, dan support runbook.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membangun mental model bahwa Camunda 8/Zeebe punya dua jalur utama:

1. **Command/write path**: client → gateway → broker partition → stream/state.
2. **Read/projection path**: broker/exporter → secondary storage → Operate/Tasklist/Optimize/API search.

Bagian ini masuk lebih dalam ke **Operate**, bukan sebagai UI biasa, tetapi sebagai **production support surface**.

Target setelah bagian ini:

- Bisa membaca state process instance dari Operate tanpa salah mengira projection sebagai source of truth mutlak.
- Bisa membedakan incident karena worker, variable, expression, message, timer, mapping, deployment, atau external dependency.
- Bisa menentukan apakah harus retry, update variable, modify instance, cancel instance, atau fix worker/service terlebih dahulu.
- Bisa membuat runbook incident production yang aman untuk sistem regulated/case-management.
- Bisa menjelaskan risiko operasional Operate: projection lag, stale data, batch operation, wrong repair, dan audit trail.

Operate bukan tempat untuk “asal klik retry”. Untuk engineer senior, Operate adalah **forensic interface**: tempat membaca akibat dari orchestration state, bukan tempat mengganti root cause analysis.

---

## 1. Apa Itu Operate dalam Camunda 8?

Secara praktis, **Operate** adalah aplikasi monitoring dan troubleshooting untuk process instances yang berjalan di Zeebe.

Ia membantu operator melihat:

- process definitions,
- running instances,
- completed instances,
- failed instances,
- incidents,
- variables,
- flow node progress,
- instance history,
- dan melakukan operasi tertentu seperti retry, resolve incident, update variable, cancel, atau modify instance.

Namun mental model yang benar:

```text
Zeebe broker stream/state
        |
        | exported records
        v
Secondary storage / read model
        |
        v
Operate UI / API
```

Operate **bukan broker**. Operate tidak mengeksekusi BPMN secara langsung. Operate menampilkan hasil dari data yang sudah di-export dan diproyeksikan.

Konsekuensinya:

- Operate sangat berguna untuk observability dan support.
- Operate bisa tertinggal jika importer/exporter/secondary storage lag.
- Operate bisa menampilkan data yang eventually consistent untuk beberapa use case.
- Command operasi dari Operate tetap harus kembali ke orchestration cluster/broker untuk berdampak ke state sebenarnya.

---

## 2. Operate sebagai Production Support Surface

Dalam production system, Operate biasanya dipakai oleh beberapa persona:

| Persona | Kebutuhan |
|---|---|
| Developer | Debug process execution, variable, mapping, worker failure |
| Support engineer | Triage incident, retry setelah dependency pulih |
| Business operator | Melihat proses stuck atau perlu aksi manual |
| SRE/platform engineer | Memeriksa indikasi systemic failure |
| BA/process owner | Memahami path instance dan bottleneck |
| Compliance/auditor | Membaca bukti eksekusi dan decision path |

Tetapi tidak semua persona boleh melakukan operasi destruktif.

Contoh operasi yang perlu dibatasi:

- update variable,
- resolve incident,
- retry incident,
- cancel process instance,
- modify process instance,
- batch retry,
- batch cancel.

Dalam sistem regulated, Operate access harus diperlakukan seperti **privileged operational access**, bukan sekadar dashboard.

---

## 3. Source of Truth: Apa yang Harus Dipercaya?

Ada beberapa level “truth” dalam Camunda 8:

| Layer | Fungsi | Catatan |
|---|---|---|
| Zeebe broker state | Source of truth runtime execution | Tidak biasa di-query langsung oleh business app |
| Exported records | Event/history stream yang diproyeksikan | Dasar read-side/audit/projection |
| Secondary storage | Read model untuk web apps/search | Bisa lag atau perlu retention/index tuning |
| Operate UI | Human support interface | Bergantung pada projection |
| Operate/API search | Programmatic read/search | Data consistency perlu dipahami |
| Domain DB | Business source of truth | Harus punya correlation ke process instance |

Kesalahan umum:

> “Di Operate belum kelihatan, berarti command belum berhasil.”

Belum tentu. Bisa jadi command sudah diterima broker, tetapi projection belum catch up.

Kesalahan lain:

> “Operate menunjukkan incident, berarti worker pasti rusak.”

Belum tentu. Incident bisa karena:

- retries habis,
- expression gagal,
- variable tidak sesuai schema,
- input/output mapping error,
- job worker tidak available,
- external API failure,
- authorization failure,
- message correlation design salah,
- BPMN model bug,
- deployment version mismatch.

---

## 4. Data Flow Operate: Dari Broker ke UI

Sederhananya:

```text
[Zeebe Broker Partition]
      |
      | records: process instance, job, variable, incident, timer, message, etc.
      v
[Exporter / Camunda Exporter]
      |
      v
[Secondary Storage]
      |
      v
[Operate Importer / Query Model]
      |
      v
[Operate UI / API]
```

Dalam self-managed deployment, secondary storage bisa berupa backend yang didukung sesuai versi/configuration. Pada banyak deployment historis/umum, Elasticsearch/OpenSearch berperan sebagai storage pencarian dan projection. Mulai generasi baru Camunda 8, dokumentasi juga mulai menekankan istilah **secondary storage** sebagai konsep umum untuk web applications dan search-based APIs.

Yang perlu diingat:

- Operate query bukan command execution.
- Operate search bukan transaksi broker.
- Operate UI bisa menunjukkan data yang belum sepenuhnya sinkron dengan state broker paling baru.
- Secondary storage harus diperlakukan sebagai production data layer: backup, monitoring, retention, capacity, security.

---

## 5. Apa yang Bisa Dilihat di Operate?

Operate biasanya membantu membaca:

1. **Process definitions**
   - BPMN process id,
   - version,
   - deployment,
   - model diagram.

2. **Process instances**
   - active,
   - completed,
   - canceled,
   - incident.

3. **Flow node state**
   - active token,
   - completed node,
   - failed node,
   - taken path,
   - not-yet-reached path.

4. **Incidents**
   - incident type,
   - element id,
   - error message,
   - affected process instance,
   - affected job or variable/expression.

5. **Variables**
   - global variables,
   - local/scope variables depending visibility,
   - latest values in projection.

6. **Operation history**
   - retry/cancel/modify/update variable depending feature/version.

7. **Batch operations**
   - retry many instances,
   - cancel many instances,
   - monitor batch progress.

---

## 6. Apa yang Tidak Boleh Diasumsikan dari Operate?

Operate tidak boleh dipakai dengan asumsi berikut:

| Salah Asumsi | Yang Benar |
|---|---|
| Operate selalu real-time sempurna | Ada projection/import lag |
| Variable di Operate selalu aman diedit | Edit variable bisa mengubah business semantics |
| Retry selalu aman | Retry bisa menggandakan side effect jika worker tidak idempotent |
| Cancel hanya “menghapus UI” | Cancel mengubah lifecycle process instance |
| Modify instance hanya memindahkan token | Bisa melompati invariants, preconditions, audit logic |
| Semua incident sama | Incident punya root cause berbeda-beda |
| Operate bisa menggantikan observability | Tetap perlu logs, metrics, traces, domain audit |

Operate adalah alat kuat. Semakin kuat alatnya, semakin ketat governance-nya.

---

## 7. Incident Mental Model

Incident adalah sinyal bahwa process instance tidak bisa maju secara otomatis tanpa intervensi.

Secara konseptual:

```text
Process instance reaches executable point
        |
        v
Job created / expression evaluated / mapping applied / event processed
        |
        +-- success --> continue
        |
        +-- transient failure with retries --> retry later
        |
        +-- retries exhausted or unrecoverable runtime problem
                |
                v
             incident
```

Incident bukan root cause. Incident adalah **symptom**.

Root cause bisa di:

- BPMN model,
- variable contract,
- worker code,
- external system,
- authentication/secret,
- network,
- deployment/version mismatch,
- data corruption,
- business data invalid,
- capacity/backpressure,
- secondary storage lag.

---

## 8. Jenis-Jenis Incident yang Umum

### 8.1 Worker Failure Incident

Ciri:

- Incident muncul pada service task.
- Error message berasal dari worker failure.
- Retries habis.
- Biasanya ada job type terkait.

Kemungkinan root cause:

- external API down,
- database error,
- invalid credential,
- worker bug,
- invalid variable shape,
- timeout,
- non-idempotent operation gagal sebagian,
- version mismatch worker vs BPMN.

Triage:

1. Lihat BPMN element id.
2. Lihat job type.
3. Lihat error message.
4. Lihat variables yang masuk ke task.
5. Cari logs worker berdasarkan `processInstanceKey`, `jobKey`, `bpmnProcessId`, `elementId`, `jobType`.
6. Tentukan apakah fix dependency cukup atau data perlu diperbaiki.
7. Retry hanya setelah root cause aman.

---

### 8.2 Expression Incident

Ciri:

- Terjadi di gateway, conditional flow, input/output mapping, assignment expression, timer expression, atau FEEL expression.
- Pesan error sering terkait variable missing, type mismatch, expression result bukan boolean, atau invalid date/duration.

Contoh:

```text
condition expression failed because variable 'riskScore' not found
```

Root cause:

- worker sebelumnya tidak menghasilkan variable yang dijanjikan,
- variable typo,
- null tidak ditangani,
- schema berubah,
- FEEL expression salah,
- output mapping salah scope,
- data migration tidak mengisi field baru.

Triage:

1. Lihat element id yang gagal.
2. Lihat expression di BPMN.
3. Inspect variables.
4. Bandingkan dengan contract/version.
5. Update variable jika benar-benar safe.
6. Resolve incident/retry.
7. Buat fix permanen di model/worker/schema.

---

### 8.3 Variable Mapping Incident

Ciri:

- Terjadi saat entering/leaving task/subprocess/call activity.
- Error terkait input/output mapping.

Root cause:

- mapping membaca variable yang tidak ada,
- mapping menulis ke scope yang salah,
- call activity contract tidak cocok,
- multi-instance variable tidak sesuai,
- payload terlalu kompleks,
- null handling buruk.

Triage:

- cek input/output mapping,
- cek scope variable,
- cek child process variable propagation,
- cek variable name collision.

---

### 8.4 Message Correlation Incident / Stuck Waiting

Tidak selalu muncul sebagai incident. Banyak kasus message bug muncul sebagai “process menunggu selamanya”.

Ciri:

- Process instance active di intermediate message catch event.
- Tidak ada incident.
- External callback mengaku sudah mengirim message.
- Process tidak lanjut.

Root cause:

- correlation key berbeda,
- message name salah,
- tenant salah,
- message TTL expired,
- callback datang ke environment salah,
- message ID duplicate/rejected,
- process belum masuk wait state saat TTL terlalu pendek,
- business key format berbeda.

Triage:

1. Lihat waiting element id.
2. Lihat expected message name.
3. Lihat correlation key variable.
4. Cek external callback logs.
5. Cek publish message command logs.
6. Cek TTL.
7. Cek tenant/environment.
8. Publish ulang message hanya jika idempotency aman.

---

### 8.5 Timer/Deadline Issue

Ciri:

- Process menunggu timer terlalu lama/cepat.
- Boundary timer tidak trigger sesuai ekspektasi.
- SLA escalation tidak terjadi.

Root cause:

- duration/date salah,
- timezone salah,
- FEEL temporal expression salah,
- due date disamakan dengan timer padahal beda konsep,
- business calendar tidak dihitung di domain service,
- timer dibuat berdasarkan variable yang salah,
- model version berubah.

Triage:

1. Cek timer expression di BPMN.
2. Cek variable timestamp/duration.
3. Cek timezone/source timestamp.
4. Cek apakah timer sudah dibuat sebelum variable berubah.
5. Cek apakah boundary timer interrupting/non-interrupting sesuai.
6. Jangan langsung modify kecuali tahu konsekuensi auditnya.

---

### 8.6 Deployment/Version Mismatch

Ciri:

- Incident terjadi setelah deployment baru.
- Worker lama menerima job type baru.
- Worker baru menerima variable schema lama.
- Running old instances gagal di task yang dimodifikasi.

Root cause:

- breaking BPMN change,
- job type berubah tanpa compatibility,
- variable contract berubah,
- worker deployment tidak synchronized,
- canary process tidak disiapkan.

Triage:

1. Lihat process definition version instance.
2. Lihat deployment timestamp.
3. Lihat worker version logs.
4. Cek compatibility matrix.
5. Putuskan rollback worker, deploy compatibility worker, atau migrate/modify instances.

---

## 9. Incident Triage Framework

Gunakan urutan ini agar tidak asal memperbaiki symptom.

```text
1. Identify affected scope
2. Classify incident type
3. Determine blast radius
4. Read process context
5. Read variable context
6. Correlate worker/domain logs
7. Decide repair strategy
8. Execute controlled operation
9. Verify process progress
10. Record root cause and permanent fix
```

### 9.1 Identify Affected Scope

Pertanyaan:

- Satu instance atau banyak?
- Satu BPMN process id atau banyak?
- Satu process version atau banyak?
- Satu job type atau banyak?
- Satu worker app atau banyak?
- Satu tenant atau semua tenant?
- Satu external dependency atau semua dependency?

Jika banyak instance pada task yang sama, kemungkinan besar root cause sistemik.

Jika hanya satu instance, kemungkinan data-specific.

---

### 9.2 Classify Incident Type

Minimal taxonomy:

| Category | Example | Repair Bias |
|---|---|---|
| Transient dependency | API down, DB timeout | Fix dependency then retry |
| Worker bug | Null pointer, wrong mapping | Deploy fix then retry |
| Data contract | Missing variable, type mismatch | Repair data/model then resolve |
| Business rejection mis-modelled | Invalid application treated as technical failure | Change BPMN/error handling |
| Deployment mismatch | New BPMN, old worker | Restore compatibility |
| Process design bug | Wrong gateway condition | Model fix + controlled repair |
| External callback/correlation | Message not correlated | Publish/replay only if safe |
| Capacity/backpressure | Worker/broker/storage overloaded | Scale/tune before retry storm |

---

### 9.3 Determine Blast Radius

Blast radius bisa dibaca dari Operate search/filter dan observability.

Contoh filter:

- process id = `application-review-process`
- version = `42`
- state = `INCIDENT`
- element id = `verifyApplicantEligibility`
- incident message contains `401 Unauthorized`

Jika 300 incident muncul dalam 10 menit pada job type sama, jangan retry manual satu-satu. Itu systemic failure.

---

### 9.4 Read Process Context

Baca diagram dengan pertanyaan:

- Instance sedang berada di milestone apa?
- Task ini sebelum/selesai side effect penting apa?
- Apakah ada compensation path?
- Apakah ada user decision sebelumnya?
- Apakah ada timer/escalation aktif?
- Apakah ini parent process atau child process?
- Apakah call activity involved?
- Apakah multi-instance involved?

Jangan lihat node gagal secara isolated. Dalam workflow, node gagal punya makna terhadap lifecycle.

---

### 9.5 Read Variable Context

Periksa variable dengan hati-hati:

- Apakah ada variable mandatory yang missing?
- Apakah tipe variable berubah?
- Apakah enum value invalid?
- Apakah timestamp valid?
- Apakah external reference id ada?
- Apakah idempotency key ada?
- Apakah worker result partial sudah tertulis?
- Apakah PII terlihat dan siapa boleh mengakses?

Dalam sistem regulated, variable inspection sendiri bisa termasuk privileged data access.

---

### 9.6 Correlate Worker and Domain Logs

Operate hanya memberi process-side context. Untuk root cause, cari di log worker/domain service.

Correlation fields yang seharusnya ada:

```text
processInstanceKey
processDefinitionKey
bpmnProcessId
processDefinitionVersion
elementId
jobKey
jobType
workerName
correlationKey
businessKey/applicationId/caseId
tenantId
traceId
spanId
```

Jika logs tidak punya field ini, support production akan lambat dan rawan salah retry.

---

## 10. Repair Decision Matrix

| Situation | Safe Operation | Dangerous Operation |
|---|---|---|
| External API was down, now recovered | Retry job/incident | Modify instance past service task tanpa side-effect check |
| Worker bug fixed and deployed | Retry affected jobs | Retry sebelum all pods updated |
| Missing variable due to data entry typo | Update variable then resolve/retry | Patch variable tanpa audit/business approval |
| Gateway expression wrong in BPMN | Deploy fixed process for new instances; repair old carefully | Batch modify all without checking versions |
| Duplicate side effect suspected | Reconcile first | Retry blindly |
| Process waiting for lost callback | Republish message with idempotency | Manually skip wait state without domain evidence |
| Task obsolete due to business cancellation | Cancel process if allowed | Delete/modify for cosmetic cleanup |
| Huge number of incidents due to outage | Batch retry after capacity check | Retry all at once causing storm |

---

## 11. Retry in Operate

Retry berarti memberi process execution kesempatan melanjutkan lagi.

Untuk job incident, retry biasanya perlu:

1. memastikan root cause sudah hilang,
2. memastikan job retries disetel kembali jika habis,
3. resolve/retry incident,
4. worker mengambil job lagi.

### 11.1 Kapan Retry Aman?

Retry relatif aman jika:

- failure terjadi sebelum side effect eksternal,
- worker idempotent,
- external API idempotent,
- dependency sudah pulih,
- variable contract sudah benar,
- worker version sudah compatible,
- tidak ada duplicate domain action.

### 11.2 Kapan Retry Berbahaya?

Retry berbahaya jika:

- worker mungkin sudah mengirim email/payment/approval ke external system,
- external API sukses tetapi worker gagal complete job,
- timeout terjadi setelah side effect,
- tidak ada idempotency key,
- worker memakai random generated external id pada tiap retry,
- operation non-repeatable.

Contoh buruk:

```text
Job: issue-license-certificate
Failure: timeout after calling external certificate API
Operator: clicks retry
Result: two certificates issued
```

Solusi seharusnya:

- reconcile external reference,
- store external result,
- make worker idempotent,
- retry after dedup check.

---

## 12. Update Variable di Operate

Operate dapat dipakai untuk memperbaiki variable tertentu ketika incident disebabkan data invalid/missing.

Namun variable update adalah operasi serius.

### 12.1 Variable Update yang Masuk Akal

Contoh:

- Fix typo enum `APPROVE` → `APPROVED`.
- Tambah missing `eligibilityResult` setelah worker lama bug.
- Koreksi date format yang salah karena migration.
- Tambah `reviewOutcome` yang seharusnya dihasilkan user task.

### 12.2 Variable Update yang Berbahaya

Contoh:

- Mengubah `riskScore` agar gateway memilih path berbeda tanpa business approval.
- Mengubah `applicantStatus` supaya proses lanjut.
- Menghapus evidence reference.
- Mengubah approval decision.
- Mengubah amount/payment state.

Untuk regulated workflow, variable update harus punya:

- siapa yang mengubah,
- kapan,
- alasan,
- approval/reference ticket,
- before/after value,
- impact analysis.

Jika Operate operation history tidak cukup untuk compliance domain, buat domain-level operational audit sendiri.

---

## 13. Resolve Incident

Resolve incident bukan berarti root cause hilang secara magis.

Secara mental model:

```text
Incident = execution blocked
Resolve = tell engine issue has been addressed and execution may proceed
```

Sebelum resolve:

- dependency sudah pulih?
- variable sudah diperbaiki?
- worker sudah redeployed?
- retries sudah disetel?
- process model path masih valid?
- side effect sudah direkonsiliasi?

Kesalahan umum:

> Resolve incident hanya untuk membersihkan dashboard.

Ini buruk. Dashboard bersih bukan berarti business state benar.

---

## 14. Cancel Process Instance

Cancel berarti menghentikan process instance.

Gunakan jika:

- business case memang dibatalkan,
- duplicate process instance dibuat,
- instance invalid sejak awal,
- test instance masuk prod secara keliru,
- proses lama harus dihentikan karena migration/cutover,
- cancellation sudah approved.

Risiko:

- running tasks hilang,
- pending timers/messages tidak relevan,
- downstream domain state mungkin masih active,
- audit harus menjelaskan kenapa dihentikan,
- parent/child relation perlu diperhatikan.

Checklist sebelum cancel:

```text
[ ] Business owner approved cancellation
[ ] Domain entity state updated or reconciled
[ ] External systems checked
[ ] Child process impact checked
[ ] Human tasks impact checked
[ ] SLA/reporting impact understood
[ ] Audit note/ticket captured
```

---

## 15. Process Instance Modification

Modification memungkinkan operator mengubah posisi token: mengaktifkan element tertentu, menghentikan active element tertentu, atau menyesuaikan path instance.

Ini sangat kuat dan sangat berbahaya.

### 15.1 Kapan Modification Berguna?

- model bug membuat instance stuck di wrong path,
- perlu bypass task obsolete setelah domain action sudah dilakukan manual,
- perlu re-enter task setelah data diperbaiki,
- perlu terminate branch paralel yang tidak lagi valid,
- perlu repair instance akibat deployment bug.

### 15.2 Risiko Modification

Modification bisa:

- melompati validation,
- melewati audit step,
- menciptakan state yang tidak mungkin terjadi dalam normal execution,
- mengaktifkan task tanpa required variables,
- men-trigger side effect ulang,
- memecahkan invariant parent/child/multi-instance,
- membuat Optimize/reporting misleading.

### 15.3 Rule of Thumb

Gunakan modification hanya jika:

```text
normal retry cannot fix it
AND variable repair alone cannot fix it
AND cancel/restart is worse
AND target state is business-valid
AND audit approval exists
```

Untuk staff-level engineer, modification bukan “debug tool”. Ia adalah **surgical repair operation**.

---

## 16. Batch Operations

Batch operation berguna saat incident massal.

Contoh:

- 5.000 instances stuck karena worker API key expired.
- External verification service down 2 jam.
- Worker bug membuat semua retries habis.
- Deployment config salah untuk satu job type.

Batch operation bisa:

- retry banyak process instances,
- cancel banyak instances,
- resolve incident banyak instances tergantung feature/API.

### 16.1 Sebelum Batch Retry

Checklist:

```text
[ ] Root cause fixed
[ ] Worker deployment complete
[ ] External dependency healthy
[ ] Idempotency verified
[ ] Capacity sufficient
[ ] Retry rate controlled
[ ] Monitoring active
[ ] Rollback/stop plan ready
[ ] Business owner aware
```

### 16.2 Batch Retry Storm

Bahaya batch retry:

```text
Thousands incidents retried at once
        |
        v
Thousands jobs activated
        |
        v
Worker/external API overloaded
        |
        v
More failures
        |
        v
More incidents
```

Mitigasi:

- scale worker sebelum retry,
- limit concurrency,
- staged retry by process/version/tenant,
- observe error rate,
- pause between batches,
- ensure external API rate limit respected.

---

## 17. Reading Process Instance State Correctly

Ketika membuka instance di Operate, jangan hanya lihat node merah.

Baca dengan urutan:

1. Process id/version.
2. Instance key.
3. Parent/child relationship.
4. Active element.
5. Incident element.
6. Previous completed nodes.
7. Variables at current point.
8. Job type/worker name.
9. Error message.
10. Timeline/history.
11. Related domain entity.
12. External system state.

Contoh reasoning:

```text
Instance applicationId=A-1007 stuck at verify-payment-result.
Previous task submit-payment completed.
Current incident says HTTP 504.
Variables contain paymentRequestId=PAY-555.
Domain DB shows payment status=SUCCESS.
Therefore retrying worker must not create a new payment.
Worker must query payment by PAY-555 and complete job using existing result.
```

Ini adalah production-grade reasoning.

---

## 18. Process Version Diagnosis

Selalu cek process version.

Kenapa?

Running instances tetap bisa berada di process definition version lama. Jika Anda deploy BPMN baru, instance lama tidak otomatis berubah modelnya kecuali ada migration/operation tertentu.

Masalah umum:

```text
BPMN v12 expects worker result variable: eligibility.status
BPMN v13 expects: eligibilityStatus
Worker v13 deployed globally
Old instance v12 now receives incompatible result
```

Atau:

```text
Worker supports job type: check-eligibility-v2
Old BPMN still creates: check-eligibility
No worker handles old job type
Incident appears
```

Support checklist:

- process definition version,
- job type,
- worker deployed version,
- variable schema version,
- deployment timestamp,
- incident start timestamp.

---

## 19. Variable Diagnosis Patterns

### 19.1 Missing Variable

Symptom:

```text
Variable 'x' not found
```

Possible root causes:

- previous worker did not output it,
- output mapping removed it,
- local scope variable not visible,
- call activity did not propagate,
- process version mismatch,
- typo in BPMN expression.

Fix:

- if one-off data issue: update variable safely,
- if systemic: fix worker/model and batch repair.

---

### 19.2 Wrong Type

Symptom:

```text
Expected boolean but got string
```

Common cause:

```json
{
  "approved": "true"
}
```

instead of:

```json
{
  "approved": true
}
```

Fix:

- repair variable,
- fix DTO serialization,
- add contract test,
- add worker output validation.

---

### 19.3 Wrong Enum

Symptom:

```text
No matching gateway condition
```

Example:

```json
{
  "decision": "Approve"
}
```

BPMN expects:

```text
APPROVED
REJECTED
NEED_MORE_INFO
```

Fix:

- standardize enum,
- avoid UI display label as process variable,
- add validation before completion.

---

### 19.4 Null Ambiguity

Null can mean:

- unknown,
- not applicable,
- not yet calculated,
- intentionally cleared,
- bug.

Do not let critical gateway depend on ambiguous null.

Better:

```json
{
  "eligibility": {
    "status": "CALCULATED",
    "eligible": true,
    "reasonCode": null
  }
}
```

than:

```json
{
  "eligible": null
}
```

---

## 20. Worker/Operate Debugging Contract

A worker that is hard to debug is not production-ready.

Every job failure should include meaningful error message, but not leak secrets/PII.

Bad failure message:

```text
Exception occurred
```

Better:

```text
ExternalEligibilityCheckFailed: provider=ONEVERIFY, httpStatus=503, retryable=true, externalRequestId=EV-2026-000123
```

Bad failure message:

```text
SQL error: select * from applicant where nric='S1234567D'
```

Better:

```text
ApplicantLookupFailed: applicantRef=APP-2026-00031, reason=DB_TIMEOUT, retryable=true
```

Principle:

```text
Enough context for repair,
not enough sensitive data to violate policy.
```

---

## 21. Production Support Playbook: Single Incident

```text
Runbook: Single Process Incident

1. Open Operate instance.
2. Capture:
   - process instance key
   - process id
   - process version
   - element id
   - incident message
   - job type if any
   - business reference
3. Classify incident:
   - worker failure
   - expression/mapping
   - message/timer stuck
   - version mismatch
   - data issue
4. Check domain entity state.
5. Check worker logs using correlation fields.
6. Determine if side effect happened.
7. Choose repair:
   - retry
   - update variable + resolve
   - fix worker + retry
   - publish missing message
   - modify instance
   - cancel/restart
8. Execute operation with ticket/reference.
9. Verify instance moves to expected next node.
10. Record RCA and permanent fix.
```

---

## 22. Production Support Playbook: Mass Incident

```text
Runbook: Mass Incident

1. Do not batch retry immediately.
2. Identify blast radius:
   - process id
   - version
   - element id
   - job type
   - tenant
   - time window
3. Stop/slow harmful workers if necessary.
4. Confirm root cause:
   - dependency outage
   - auth/secret expiry
   - worker deployment bug
   - BPMN bug
   - bad data migration
5. Fix root cause.
6. Validate with 1-3 sample instances.
7. Check idempotency risk.
8. Scale capacity if needed.
9. Execute staged batch retry.
10. Monitor error rate, latency, external API rate limit.
11. Pause if failures recur.
12. Finish batch.
13. Produce RCA and prevention action.
```

---

## 23. Operate and External Observability

Operate answers process questions:

- Where is the process stuck?
- Which element failed?
- What variables were present?
- Which process version?
- Which incidents exist?

Logs answer execution questions:

- What did the worker do?
- What external API was called?
- What error occurred?
- Was side effect completed?

Metrics answer system questions:

- Are workers healthy?
- Is job activation rate normal?
- Is failure rate rising?
- Is exporter/importer lagging?
- Is secondary storage slow?

Traces answer distributed path questions:

- Which service call took too long?
- Where was the request dropped?
- Which dependency caused latency?

Domain audit answers business questions:

- Who approved?
- What decision was made?
- What evidence was used?
- Why was manual override done?

Operate is one piece of the support puzzle, not the whole puzzle.

---

## 24. Common Production Debugging Scenarios

### Scenario A — Worker Down

Symptoms:

- many service tasks active,
- no completions,
- incidents may appear after timeout/retries,
- worker metrics show zero active pods or failed readiness.

Action:

- restore worker,
- check job timeout,
- check if jobs will be reactivated,
- retry incidents if retries exhausted,
- watch activation burst.

---

### Scenario B — External API Down

Symptoms:

- incidents on one job type,
- error message says 503/timeout,
- worker logs consistent.

Action:

- wait/fix dependency,
- avoid retry storm,
- batch retry gradually,
- verify idempotency.

---

### Scenario C — Bad Variable from UI

Symptoms:

- gateway expression fails,
- variable shape invalid,
- only few instances affected.

Action:

- repair variable if approved,
- resolve incident,
- fix UI validation.

---

### Scenario D — New BPMN Deployed, Old Worker Still Running

Symptoms:

- incidents start after deployment,
- job type unknown,
- worker logs show no handler.

Action:

- deploy compatible worker,
- or rollback BPMN start behavior for new instances,
- retry affected jobs,
- add release checklist.

---

### Scenario E — Message Callback Lost

Symptoms:

- instance waits at message catch,
- external system says callback sent,
- no incident.

Action:

- compare message name/correlation key,
- check callback endpoint logs,
- republish if safe,
- add durable inbound message inbox.

---

### Scenario F — Duplicate Side Effect Suspected

Symptoms:

- worker timeout,
- external system maybe processed request,
- incident at service task.

Action:

- do not retry immediately,
- query external system by idempotency key,
- update domain record,
- complete/retry with idempotent logic,
- improve worker.

---

## 25. Designing for Operability Upfront

Operate support quality is determined during design, not during incident.

Design checklist:

```text
[ ] BPMN element ids are meaningful
[ ] Job types are stable and descriptive
[ ] Error messages are actionable
[ ] Variables have clean contract
[ ] Business reference is always present
[ ] Process instance can be mapped to domain entity
[ ] Worker logs include process/job correlation
[ ] External side effects use idempotency keys
[ ] Retry policy matches dependency behavior
[ ] BPMN errors model business rejection
[ ] Technical failures become retry/incident
[ ] Timer/deadline variables are explicit
[ ] User decisions are structured and auditable
[ ] Process version compatibility is documented
```

Bad BPMN element id:

```text
Task_0x9a1b2
```

Good BPMN element id:

```text
verifyApplicantEligibility
```

Bad job type:

```text
service-task
```

Good job type:

```text
regulatory.application.verify-eligibility.v1
```

---

## 26. Naming for Supportability

Recommended naming convention:

### BPMN Process ID

```text
regulatory-application-review
```

### Element ID

```text
validateApplicationSubmission
verifyApplicantEligibility
waitForExternalAgencyResponse
reviewApplicationByOfficer
issueApprovalLetter
```

### Job Type

```text
regulatory.application.validate-submission.v1
regulatory.application.verify-eligibility.v1
regulatory.application.generate-letter.v1
```

### Error Code

```text
ELIGIBILITY_PROVIDER_TIMEOUT
ELIGIBILITY_INVALID_RESPONSE
APPLICATION_SCHEMA_INVALID
LETTER_TEMPLATE_NOT_FOUND
```

### Business Reference Variable

```json
{
  "caseId": "CASE-2026-000102",
  "applicationId": "APP-2026-009912",
  "tenantId": "agency-a"
}
```

Naming is not cosmetic. It reduces mean time to repair.

---

## 27. Operate Access Governance

Recommended permission levels:

| Role | View | Retry | Update Variables | Modify | Cancel | Batch |
|---|---:|---:|---:|---:|---:|---:|
| Developer DEV | Yes | Yes | Yes | Yes | Yes | Yes |
| Developer PROD | Limited | No/Controlled | No | No | No | No |
| Support L1 | Yes | No | No | No | No | No |
| Support L2 | Yes | Controlled | Controlled | No | Controlled | Controlled |
| SRE | Yes | Controlled | No | No | Controlled | Controlled |
| Process Owner | Yes | Approve | Approve | Approve | Approve | Approve |
| Auditor | Read-only | No | No | No | No | No |

For production, avoid giving broad modification permissions by default.

---

## 28. Audit and Regulatory Defensibility

In regulated workflows, production repair must answer:

1. What happened?
2. Which case/process was affected?
3. Why did it happen?
4. Who intervened?
5. What exactly was changed?
6. What evidence justified the change?
7. Was the applicant/customer/case outcome affected?
8. Was SLA affected?
9. Was the permanent fix implemented?
10. Could this happen again?

Operate may provide some operational history, but regulated systems often need additional **operational repair ledger**.

Example repair ledger fields:

```text
repair_id
process_instance_key
bpmn_process_id
process_version
business_reference
tenant_id
incident_key
element_id
operation_type
before_snapshot_ref
after_snapshot_ref
reason_code
approval_ticket
performed_by
performed_at
verified_by
verified_at
permanent_fix_ref
```

---

## 29. Custom Support Tooling Around Operate

For enterprise systems, Operate UI may not be enough.

You may build internal support tooling that combines:

- Operate/Orchestration Cluster APIs,
- domain DB,
- worker logs,
- external system status,
- repair approval workflow,
- audit ledger,
- business-friendly case timeline.

Architecture:

```text
Support Portal
    |
    +-- Camunda search/process/incident API
    +-- Domain case API
    +-- Log/tracing links
    +-- External dependency status
    +-- Repair approval workflow
    +-- Audit ledger
```

Important rule:

> Custom support portal should not bypass Camunda command semantics. It should orchestrate safe operations through approved APIs and record audit metadata.

---

## 30. Operate API and REST-Based Operations

Modern Camunda 8 exposes REST APIs around orchestration cluster capabilities such as process instances, incidents, variables, user tasks, and batch operations depending on version/endpoint.

Use API automation when:

- mass incident requires controlled staged retry,
- support portal needs search,
- operational audit needs snapshots,
- integration with ticketing/approval is required,
- read-only dashboard needs process status.

But avoid building business logic that depends on eventually consistent search result for critical command decisions unless you understand consistency boundaries.

Bad:

```text
If Operate search does not show active process, create a new one.
```

Better:

```text
Use domain-level uniqueness and idempotency for process start.
Use process instance key/business reference mapping in durable DB.
Treat search as visibility, not uniqueness control.
```

---

## 31. Consistency Traps

### Trap 1 — Create Then Search Immediately

```text
create process instance
immediately search Operate
not found
create another instance
```

This creates duplicate process instances.

Fix:

- store process instance key returned by create command,
- use idempotency at domain layer,
- avoid read-after-write assumption on projection.

---

### Trap 2 — Complete Job Then UI Still Shows Active

Projection may lag. Do not assume completion failed only because UI has not updated.

Fix:

- check worker command response,
- check logs,
- wait/refresh,
- inspect metrics if lag persists.

---

### Trap 3 — Batch Retry Based on Stale Search

Search result may include instances already repaired or changed.

Fix:

- narrow filters,
- revalidate sample,
- batch carefully,
- monitor batch outcome.

---

## 32. Runbook: Projection Lag Suspected

Symptoms:

- worker logs show jobs completed,
- Operate still shows active/incident,
- many processes appear delayed,
- secondary storage CPU/latency high,
- exporter/importer metrics abnormal.

Actions:

```text
1. Do not retry just because UI is stale.
2. Check Zeebe/broker health.
3. Check exporter/importer metrics.
4. Check secondary storage health.
5. Check Operate logs.
6. Compare recent instance with older known state.
7. Inform support that visibility is delayed.
8. Avoid destructive operations until consistency understood.
```

---

## 33. Process Instance Modification Example

Scenario:

- Process stuck at `waitForExternalAgencyResponse`.
- External agency response was manually received and verified.
- Original callback was lost due to endpoint outage.
- Business owner approves manual continuation.

Bad repair:

```text
Modify token to issueApprovalLetter directly.
```

Why bad?

- skips validation,
- skips recording external response,
- may bypass reviewer decision,
- audit gap.

Better repair:

1. Write external response to domain DB/evidence store.
2. Update process variable with `externalAgencyResponseRef` if needed.
3. Publish missing message with same correlation key if process is waiting for message.
4. Let normal BPMN path continue.
5. If message path impossible, modify to the next validation step, not final outcome.
6. Record audit.

Principle:

> Prefer restoring the expected event/data and letting the model proceed naturally.

---

## 34. Retry Example with Idempotency

Scenario:

- Job `generateApprovalLetter` failed with timeout.
- External document service might have generated the letter.

Bad worker behavior:

```java
String documentId = documentClient.generateLetter(request);
client.newCompleteCommand(job.getKey())
      .variables(Map.of("documentId", documentId))
      .send()
      .join();
```

If complete command fails after document generation, retry may generate another document.

Better behavior:

```java
String idempotencyKey = "letter:" + caseId + ":approval:v1";

DocumentResult result = documentClient.generateOrGetLetter(idempotencyKey, request);

client.newCompleteCommand(job.getKey())
      .variables(Map.of(
          "approvalLetter", Map.of(
              "documentId", result.documentId(),
              "idempotencyKey", idempotencyKey,
              "status", "GENERATED"
          )
      ))
      .send()
      .join();
```

Operate support then sees enough variable/log context to retry safely.

---

## 35. What to Put in Worker Failure Messages

Recommended structure:

```text
<ErrorCode>: <short human-readable summary>; retryable=<true|false>; externalRef=<id>; detailsRef=<log/correlation id>
```

Examples:

```text
ELIGIBILITY_PROVIDER_TIMEOUT: Provider did not respond within 10s; retryable=true; externalRef=REQ-88391; traceId=abc123
```

```text
APPLICATION_SCHEMA_INVALID: Missing mandatory field applicant.category; retryable=false; validationRef=VAL-2026-0081
```

```text
PAYMENT_STATUS_AMBIGUOUS: Payment API timed out after request submission; retryable=false; reconciliationRequired=true; paymentRequestId=PAY-9912
```

Notice the third example marks retryable false because ambiguity requires reconciliation first.

---

## 36. Incident Ownership Model

Every incident category should have owner.

| Incident Category | Primary Owner | Secondary Owner |
|---|---|---|
| Worker exception | App team | Platform/SRE |
| External API outage | Integration owner | App team |
| Variable contract issue | App team | BA/process owner |
| BPMN modelling issue | Process engineering team | App team |
| Auth/secret failure | Platform/security | App team |
| Secondary storage lag | Platform/SRE | App team |
| Business data invalid | Business ops | App team |
| Migration/version mismatch | Release manager | App/process team |

Without ownership, incidents become dashboard noise.

---

## 37. Support Severity Classification

Example:

| Severity | Criteria | Example |
|---|---|---|
| SEV-1 | Critical process stopped broadly | All application approvals stuck |
| SEV-2 | Major function degraded | External verification job incidents increasing |
| SEV-3 | Limited set affected | 10 cases stuck due to bad data |
| SEV-4 | Cosmetic/low impact | Old completed instance display issue |

Severity should consider:

- number of affected cases,
- SLA/deadline impact,
- regulatory impact,
- financial/customer impact,
- workaround availability,
- data integrity risk.

---

## 38. Operate in DEV/SIT/UAT/PROD

### DEV

Purpose:

- developer debugging,
- model iteration,
- variable inspection,
- aggressive modification acceptable.

### SIT

Purpose:

- integration debugging,
- message correlation verification,
- worker contract testing,
- external system simulation.

### UAT

Purpose:

- business scenario verification,
- user task validation,
- form and assignment validation,
- support rehearsal.

### PROD

Purpose:

- controlled support,
- incident triage,
- approved repair,
- audit evidence.

Never carry DEV habits into PROD.

---

## 39. Production Readiness Checklist for Operate

```text
[ ] Operate access integrated with enterprise IAM
[ ] Read-only and operator roles separated
[ ] Variable update permission restricted
[ ] Process modification permission restricted
[ ] Batch operation permission restricted
[ ] Secondary storage monitored
[ ] Exporter/importer lag monitored
[ ] Operate logs monitored
[ ] Runbooks created
[ ] Support team trained
[ ] Worker logs include process correlation
[ ] Error messages actionable and sanitized
[ ] Business reference visible in variables/search
[ ] Incident ownership defined
[ ] Batch retry procedure documented
[ ] Manual repair audit ledger available
[ ] Sensitive variables minimized/masked where possible
[ ] Retention policy defined
[ ] Backup/restore strategy includes secondary storage needs
[ ] DR procedure tested
```

---

## 40. Design Review Questions

Use these questions when reviewing a Camunda 8 system:

1. If a process instance gets stuck, how does support find the business case?
2. If a worker fails after external side effect, how do we retry safely?
3. If 10.000 incidents happen, how do we avoid retry storm?
4. If Operate lags, how do we know execution state?
5. If a variable is wrong, who is allowed to update it?
6. If a process model bug affects running instances, what is our repair strategy?
7. If old process version is still running, are workers still compatible?
8. If a message callback is lost, can we replay it safely?
9. If a human decision was wrong, is correction modelled or patched?
10. If an auditor asks why a case moved forward, can we prove it?

---

## 41. Senior-Level Mental Model

Junior view:

> Operate is where I see errors and click retry.

Mid-level view:

> Operate helps me debug process instances and variables.

Senior view:

> Operate is an operational projection over distributed workflow execution. It must be interpreted with consistency, idempotency, side-effect, audit, and release-version awareness.

Staff/principal view:

> Operate is one surface in a broader operational control plane. The system must be designed so that every repair operation is safe, explainable, auditable, rate-controlled, and compatible with domain invariants.

---

## 42. Key Takeaways

1. Operate is for monitoring and troubleshooting Zeebe process instances, but it depends on read-side projection.
2. Incident is a symptom, not the root cause.
3. Retry is safe only if side effects and idempotency are understood.
4. Variable update is a business/state mutation and needs governance.
5. Process instance modification is surgical repair, not normal debugging.
6. Batch operations can save hours or cause retry storms.
7. Production support requires correlation between Operate, worker logs, domain DB, external systems, metrics, and audit ledger.
8. Operability must be designed into BPMN element names, job types, variable contracts, error messages, and worker logs.
9. In regulated systems, every manual repair must be explainable and auditable.
10. A top-tier engineer does not ask “how do I clear this incident?” but “what state transition is safe, truthful, and defensible?”

---

## 43. References

- Camunda 8 Docs — Introduction to Operate: https://docs.camunda.io/docs/components/operate/operate-introduction/
- Camunda 8 Docs — Resolve incidents and update variables: https://docs.camunda.io/docs/components/operate/userguide/resolve-incidents-update-variables/
- Camunda 8 Docs — Modify a process instance: https://docs.camunda.io/docs/components/operate/userguide/process-instance-modification/
- Camunda 8 Docs — Initiate a batch operation: https://docs.camunda.io/docs/components/operate/userguide/selections-operations/
- Camunda 8 Docs — Incidents: https://docs.camunda.io/docs/components/concepts/incidents/
- Camunda 8 Docs — Process instance modification: https://docs.camunda.io/docs/components/concepts/process-instance-modification/
- Camunda 8 Docs — Orchestration Cluster REST API: https://docs.camunda.io/docs/apis-tools/orchestration-cluster-api-rest/orchestration-cluster-api-rest-overview/
- Camunda 8 Docs — Search process instances: https://docs.camunda.io/docs/apis-tools/orchestration-cluster-api-rest/specifications/search-process-instances/
- Camunda 8 Docs — Resolve incident API: https://docs.camunda.io/docs/apis-tools/orchestration-cluster-api-rest/specifications/resolve-incident/
- Camunda 8 Docs — Secondary storage with Elasticsearch/OpenSearch: https://docs.camunda.io/docs/self-managed/components/orchestration-cluster/core-settings/concepts/elasticsearch-and-opensearch/
- Camunda 8 Docs — Exporters: https://docs.camunda.io/docs/self-managed/concepts/exporters/

---

# Status Seri

Seri **belum selesai**.

Bagian berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-019.md
```

Judul berikutnya:

```text
Part 019 — Tasklist and Human Work Management at Scale
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-017.md">⬅️ Part 017 — Exporters, Elasticsearch/OpenSearch, Operate, Tasklist, and Read-Side Architecture</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-019.md">Part 019 — Tasklist and Human Work Management at Scale ➡️</a>
</div>
