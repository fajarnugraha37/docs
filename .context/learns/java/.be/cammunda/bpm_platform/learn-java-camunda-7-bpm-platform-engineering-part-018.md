# learn-java-camunda-7-bpm-platform-engineering-part-018.md

# Part 018 — Process Versioning, Deployment, Migration, dan Long-Running Instance Evolution

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Fokus: Camunda BPM Platform / Camunda 7, version `<= 7.x`  
> Target pembaca: Java engineer senior/principal yang ingin memahami Camunda 7 sebagai durable process platform, bukan hanya BPMN runtime.  
> Prasyarat langsung: Part 000–017, khususnya execution tree, transaction boundary, job executor, variable system, history, incident, dan recovery semantics.

---

## 0. Tujuan Part Ini

Di part ini kita membahas salah satu bagian yang paling menentukan apakah implementasi Camunda 7 akan aman untuk enterprise long-running workflow atau justru menjadi bom waktu: **process versioning, deployment, dan migration**.

Banyak engineer memahami versioning secara dangkal:

> “Kalau BPMN di-deploy ulang, Camunda bikin versi baru.”

Itu benar, tetapi belum cukup. Pertanyaan engineering yang lebih penting adalah:

1. Apa yang terjadi pada process instance yang sudah berjalan ketika model baru di-deploy?
2. Bagaimana start event memilih versi proses?
3. Bagaimana call activity memilih versi child process?
4. Bagaimana business rule task memilih versi decision?
5. Apa risiko jika process definition berubah sementara instance lama masih aktif?
6. Kapan kita cukup deploy versi baru, kapan harus migrate instance lama, dan kapan sebaiknya tidak migrate?
7. Bagaimana cara membuat model dan kode Java tetap kompatibel untuk process yang berjalan berbulan-bulan atau bertahun-tahun?
8. Bagaimana melakukan migration tanpa merusak audit, task ownership, timers, incidents, variables, dan external integration?

Part ini akan membangun mental model tersebut dari bawah.

---

## 1. Problem Utama: Workflow Tidak Hidup Seperti Request/Response Biasa

Dalam aplikasi web biasa, deployment baru biasanya berarti:

```text
Request berikutnya memakai code baru.
Request lama sudah selesai.
```

Dalam workflow engine, kenyataannya berbeda:

```text
Process instance dibuat di versi 3.
Instance menunggu user task selama 20 hari.
Sementara itu BPMN versi 4, 5, dan 6 sudah di-deploy.
Ketika user menyelesaikan task, instance lama tetap berjalan berdasarkan process definition version tempat ia dimulai, kecuali dimigrasikan secara eksplisit.
```

Ini membuat Camunda 7 lebih mirip **durable state machine registry** daripada stateless application runtime.

### 1.1 Kesalahan Mental Model

Kesalahan umum:

> “Saya deploy BPMN baru, berarti semua process langsung memakai flow baru.”

Yang lebih akurat:

> Deployment baru membuat **process definition version baru**. Instance baru bisa memakai versi baru, tetapi instance lama tetap terikat pada process definition lama kecuali ada migration eksplisit.

Camunda 7 menyimpan process definition di repository table, runtime instance menunjuk ke process definition tertentu, dan engine menggunakan definition itu untuk melanjutkan eksekusi.

---

## 2. Konsep Dasar Deployment di Camunda 7

Deployment adalah unit publikasi resource ke repository Camunda.

Resource bisa berupa:

- BPMN XML,
- DMN XML,
- CMMN XML,
- form/resource tambahan,
- diagram metadata,
- deployment metadata.

Secara database, deployment dan definition berada di keluarga tabel `ACT_RE_*`:

```text
ACT_RE_DEPLOYMENT
  Deployment metadata.

ACT_RE_PROCDEF
  Process definition metadata.

ACT_RE_DECISION_DEF
  DMN decision definition metadata.

ACT_RE_CASE_DEF
  CMMN case definition metadata.

ACT_GE_BYTEARRAY
  Raw deployment resources: BPMN XML, DMN XML, diagram, serialized artifacts.
```

Deployment bukan sekadar upload file. Deployment adalah operasi yang menyebabkan engine:

1. membaca resource,
2. parse BPMN/DMN/CMMN,
3. validate model,
4. membuat metadata definition,
5. menyimpan resource ke DB,
6. menaikkan version jika definition key yang sama sudah ada,
7. memperbarui deployment cache.

---

## 3. Process Definition Key, Id, Version, dan Version Tag

Camunda 7 memiliki beberapa identifier yang sering tertukar.

### 3.1 Process Definition Key

Process definition key berasal dari BPMN `process id`.

Contoh:

```xml
<bpmn:process id="enforcement_case_process" name="Enforcement Case Process" isExecutable="true">
```

Maka key-nya:

```text
enforcement_case_process
```

Key adalah logical name lintas versi.

### 3.2 Process Definition Version

Version adalah angka incremental yang dikelola engine untuk key yang sama.

Contoh:

```text
key = enforcement_case_process
version = 1
version = 2
version = 3
```

Version naik ketika deployment baru membawa process definition dengan key yang sama.

### 3.3 Process Definition Id

Id adalah identifier spesifik untuk satu process definition version.

Bentuknya biasanya seperti:

```text
enforcement_case_process:3:9f0d4a6e-...
```

Id inilah yang menunjuk ke versi spesifik.

### 3.4 Version Tag

Version tag adalah metadata business/application-level yang bisa diberikan pada process definition.

Contoh:

```xml
<bpmn:process
  id="enforcement_case_process"
  name="Enforcement Case Process"
  camunda:versionTag="2026.Q2.CR-1842"
  isExecutable="true">
```

Version tag tidak menggantikan engine version. Ia berguna untuk:

- release traceability,
- audit,
- mapping ke change request,
- environment comparison,
- operator diagnostics.

### 3.5 Ringkasan

| Konsep | Arti | Stabil lintas versi? | Dipakai untuk |
|---|---|---:|---|
| Key | Logical process name dari BPMN process id | Ya | Start by key, query latest |
| Version | Angka increment engine | Tidak | Membedakan deployment version |
| Id | Unique id definition version | Tidak | Start exact definition |
| Version tag | Metadata release/business | Tergantung policy | Traceability |

---

## 4. Start Process: By Key, By Id, atau By Message?

Pilihan start method menentukan version selection.

### 4.1 Start by Key

Contoh:

```java
runtimeService.startProcessInstanceByKey(
    "enforcement_case_process",
    businessKey,
    variables
);
```

Secara umum, start by key memilih **latest version** dari process definition key tersebut, dengan tenant rules jika multi-tenancy dipakai.

Ini cocok untuk mayoritas kasus:

```text
Permohonan baru harus memakai flow terbaru.
```

Risikonya:

```text
Jika deployment baru belum siap secara code/config/integration, request baru bisa masuk ke model baru yang broken.
```

Maka deployment pipeline harus memastikan:

- BPMN valid,
- delegate/bean tersedia,
- variables contract compatible,
- external task topic tersedia,
- DMN/called process binding valid,
- environment config lengkap.

### 4.2 Start by Process Definition Id

Contoh:

```java
runtimeService.startProcessInstanceById(
    processDefinitionId,
    businessKey,
    variables
);
```

Ini memulai versi spesifik.

Cocok jika:

- butuh controlled rollout,
- feature flag menentukan versi proses,
- request tertentu harus memakai versi lama,
- migration/replay scenario,
- regulatory process harus memakai versi yang berlaku pada tanggal tertentu.

Trade-off:

- caller harus tahu exact id,
- release management lebih kompleks,
- risk salah memilih stale version.

### 4.3 Start by Message

Message start event juga memiliki version selection semantics.

Contoh high-level:

```java
runtimeService
    .createMessageCorrelation("CaseSubmitted")
    .processInstanceBusinessKey(businessKey)
    .setVariables(variables)
    .correlateStartMessage();
```

Dalam desain enterprise, message start harus diperlakukan sebagai public workflow contract:

```text
message name + correlation facts + payload version + business key policy
```

Jika message start event berubah antar versi, inbound integration harus dipastikan tidak accidentally start versi yang salah.

---

## 5. Instance Lama Tidak Otomatis Pindah ke Definition Baru

Ketika process instance sudah berjalan, ia terikat pada `PROC_DEF_ID_` tertentu.

Contoh runtime:

```text
ACT_RU_EXECUTION.PROC_DEF_ID_ = enforcement_case_process:3:abc...
```

Jika version 4 di-deploy, instance lama tetap menunjuk version 3.

Ini adalah default yang benar, karena long-running instance harus stabil.

Bayangkan jika instance lama otomatis pindah:

1. User task lama hilang dari model baru.
2. Boundary event baru tiba-tiba muncul tanpa context.
3. Variable yang diperlukan versi baru belum ada.
4. External task topic berubah.
5. DMN decision berubah dan hasil audit berbeda.
6. Call activity binding berubah.
7. Parallel gateway structure berubah dan token lama tidak bisa dipetakan.

Automatic migration akan berbahaya.

Maka Camunda 7 memisahkan:

```text
Deploy new version  ≠  migrate existing instances
```

---

## 6. Deployment Cache: Mengapa Engine Tidak Selalu Membaca BPMN dari DB

Camunda 7 memakai deployment cache untuk definition yang sudah di-parse.

Mental model:

```text
Repository DB menyimpan source of truth.
Deployment cache menyimpan parsed executable model untuk runtime execution.
```

Tujuan cache:

- menghindari parse BPMN berulang,
- mengurangi DB access,
- mempercepat runtime execution,
- menyimpan parsed model yang dibutuhkan command execution.

### 6.1 Implikasi Cluster

Dalam cluster embedded/shared engine:

```text
Node A deploy process.
Node B mungkin perlu load definition dari DB ketika menjalankan instance/job.
```

Jika process application/classloader berbeda antar node, node yang mengambil job mungkin tidak punya delegate class/bean yang dibutuhkan.

Karena itu kita perlu memahami:

- homogeneous cluster,
- heterogeneous cluster,
- deployment-aware job executor,
- process application registration,
- rolling deployment strategy.

Ini sudah disentuh di part Job Executor, tetapi versioning membuatnya lebih kritis.

---

## 7. Deployment Modes: Embedded, Shared Engine, Remote Engine

Versioning risk berbeda berdasarkan topology.

### 7.1 Embedded Engine in Spring Boot Application

Model:

```text
Application jar
  - process engine
  - BPMN resources
  - delegate beans/classes
  - REST/domain API
```

Kelebihan:

- BPMN dan Java code release bersama,
- classpath relatif predictable,
- easier local testing,
- good for modular monolith/process app.

Risiko:

- instance lama bisa membutuhkan delegate code lama,
- rolling deployment harus hati-hati,
- process definition version dan application version harus ditrace.

### 7.2 Shared Engine

Model:

```text
Application server / shared Camunda engine
  process applications deployed separately
```

Kelebihan:

- central engine,
- multi-application possible,
- enterprise app-server friendly.

Risiko:

- classloader issue,
- deployment registration issue,
- job executor mengambil job untuk deployment yang tidak tersedia,
- debugging lebih sulit.

### 7.3 Remote Engine / Process Platform Service

Model:

```text
Business apps call Camunda REST API.
Engine runs as separate service.
Workers may be separate.
```

Kelebihan:

- central workflow platform,
- controlled API,
- easier governance.

Risiko:

- BPMN-to-code binding harus remote-safe,
- JavaDelegate lokal engine harus diminimalkan,
- external task/message pattern lebih cocok,
- engine API exposure harus dibatasi.

---

## 8. Binding Problem: Process Definition Tidak Berdiri Sendiri

Process definition version bukan hanya BPMN diagram.

Ia bisa mengikat ke:

- JavaDelegate class,
- Spring bean name,
- CDI bean,
- expression method,
- listener,
- external task topic,
- called process,
- DMN decision,
- form key,
- task candidate group,
- message name,
- signal name,
- error code,
- variable name/type,
- script,
- connector,
- tenant id.

Maka perubahan kecil di BPMN bisa berdampak luas.

Contoh:

```xml
<camunda:delegateExpression>${eligibilityCheckDelegate}</camunda:delegateExpression>
```

Jika bean `eligibilityCheckDelegate` berubah signature/behavior, instance lama yang masih berada sebelum service task tersebut akan memakai behavior baru ketika nanti sampai ke task tersebut.

Ini penting:

> Camunda menyimpan process definition version, tetapi Java code yang dieksekusi tergantung runtime classpath saat eksekusi, bukan snapshot code lama.

Jadi versioning BPMN tidak otomatis berarti versioning code.

---

## 9. Long-Running Instance Compatibility

Untuk long-running workflow, kita harus mendesain compatibility pada beberapa layer.

### 9.1 BPMN Compatibility

Pertanyaan:

- Apakah activity id tetap stabil?
- Apakah user task lama masih ada?
- Apakah gateway logic berubah?
- Apakah boundary event berubah?
- Apakah multi-instance structure berubah?
- Apakah subprocess scope berubah?
- Apakah call activity target berubah?
- Apakah message names berubah?
- Apakah timer definitions berubah?

Activity id sangat penting untuk migration, activity instance tree, history, operation, dan diagnostics.

Anti-pattern:

```text
Mengubah id activity hanya karena rename label di modeler.
```

Lebih baik:

```text
ID stabil, label boleh berubah.
```

Contoh:

```xml
<bpmn:userTask id="review_case" name="Review Case Application" />
```

Jika label berubah:

```xml
<bpmn:userTask id="review_case" name="Review Enforcement Case" />
```

ID tetap `review_case`.

### 9.2 Variable Compatibility

Variable lama mungkin tidak punya field yang dibutuhkan versi baru.

Contoh versi lama:

```json
{
  "caseId": "CASE-001",
  "riskLevel": "HIGH"
}
```

Versi baru butuh:

```json
{
  "caseId": "CASE-001",
  "riskLevel": "HIGH",
  "screeningVersion": "v2",
  "agencyCode": "CEA"
}
```

Jika instance lama dimigrasikan tanpa backfill, delegate versi baru bisa gagal.

Maka perlu:

- defaulting,
- variable migration,
- tolerant reader pattern,
- schema version field,
- validation before migration.

### 9.3 Delegate Compatibility

Delegate harus mampu menangani instance lama.

Buruk:

```java
String agencyCode = (String) execution.getVariable("agencyCode");
if (agencyCode.equals("CEA")) {
    // NPE for old instances
}
```

Lebih baik:

```java
String agencyCode = (String) execution.getVariable("agencyCode");
if (agencyCode == null) {
    agencyCode = inferAgencyCodeFromCase((String) execution.getVariable("caseId"));
}
```

Namun defaulting diam-diam juga berbahaya jika berdampak legal. Untuk regulatory workflow, fallback harus eksplisit dan teraudit.

### 9.4 External Contract Compatibility

External task topic, message name, REST callback, Kafka event, dan outbox command adalah kontrak.

Jika topic berubah:

```text
old topic: perform-screening
new topic: perform-risk-screening-v2
```

Instance lama yang masih menunggu old topic harus tetap punya worker, atau dimigrasikan ke activity baru.

### 9.5 Form Compatibility

Tasklist form atau custom UI form punya contract:

- form key,
- variable input,
- output variable,
- validation rule,
- decision values,
- permissions.

User task lama bisa dibuka setelah aplikasi UI berubah. UI harus bisa render old task version atau task harus dimigrasikan/closed secara aman.

---

## 10. Call Activity Binding

Call activity sering menjadi sumber versioning issue.

Ada beberapa binding style, tergantung Camunda 7 capability/configuration/modeler support:

- latest,
- deployment,
- version,
- versionTag.

Mental model:

```text
Parent process version controls call activity element.
Binding controls which child process definition version is called.
```

### 10.1 Latest Binding

```text
Setiap kali call activity dieksekusi, child process latest version dipakai.
```

Kelebihan:

- child process bisa diperbaiki tanpa redeploy parent,
- instance baru/lanjut memakai child terbaru.

Risiko:

- parent process versi lama bisa tiba-tiba memanggil child process versi baru,
- audit behavior berubah,
- variable contract bisa mismatch,
- testing matrix membesar.

### 10.2 Deployment Binding

```text
Call activity memilih child process yang berada dalam deployment yang sama dengan parent.
```

Kelebihan:

- parent-child release lebih atomic,
- cocok untuk tightly coupled process set.

Risiko:

- harus deploy parent dan child bersama,
- patch child independent lebih sulit.

### 10.3 Version Binding

```text
Call activity memilih child process version number tertentu.
```

Kelebihan:

- deterministic.

Risiko:

- version number environment-specific bisa berbeda jika deployment history tidak identik.
- fragile antar DEV/UAT/PROD jika tidak ada discipline.

### 10.4 Version Tag Binding

```text
Call activity memilih child process berdasarkan version tag.
```

Kelebihan:

- lebih business/release friendly,
- bisa align dengan release train/CR.

Risiko:

- version tag governance wajib ketat,
- duplicate/missing tag harus dicegah.

### 10.5 Rule of Thumb

| Scenario | Binding yang sering aman |
|---|---|
| Parent-child dirilis bersama | deployment |
| Child adalah shared stable subprocess | versionTag atau controlled latest |
| Regulatory flow butuh reproducibility | deployment/versionTag |
| Fast evolving child independent | latest dengan contract test kuat |
| Multi-environment strict release | versionTag lebih jelas daripada numeric version |

---

## 11. DMN Decision Binding

Business rule task yang memanggil DMN punya problem mirip call activity.

Pertanyaan:

- Apakah process lama harus memakai decision lama?
- Apakah decision terbaru boleh berlaku untuk semua case yang belum sampai decision point?
- Apakah perubahan decision policy berlaku berdasarkan tanggal submit, tanggal review, atau tanggal decision dibuat?

Contoh regulatory:

```text
Case submitted on 2026-01-10.
Rule changed on 2026-02-01.
Review happens on 2026-02-12.
Which rule should apply?
```

Jawabannya bukan teknis; itu policy domain/legal.

Camunda binding hanya mengimplementasikan policy tersebut.

### 11.1 Decision Versioning Policy

Kemungkinan policy:

1. **Latest at execution time**  
   Semua decision memakai rule terbaru saat activity dieksekusi.

2. **Rule at submission time**  
   Case memakai decision version yang berlaku saat case dibuat.

3. **Rule at event effective date**  
   Case memakai rule berdasarkan effective date domain.

4. **Manual override**  
   Operator memilih decision policy karena exceptional case.

Policy harus tertulis, bukan implisit di BPMN.

---

## 12. Migration: Apa Itu dan Bukan Apa

Process instance migration adalah operasi untuk memindahkan running process instance dari source process definition ke target process definition.

Bukan berarti:

- replay dari awal,
- menghapus history lama,
- otomatis memperbaiki variable,
- otomatis update external systems,
- otomatis mengubah business decision,
- magic compatibility resolver.

Migration berarti:

```text
Active execution/activity/event scope tertentu pada source definition dipetakan ke activity/scope pada target definition.
```

Misalnya:

```text
source: user_task_review_v1
 target: user_task_review_v2
```

Migration API bekerja dengan migration plan dan instruction.

---

## 13. Kapan Perlu Migrate?

Tidak semua perubahan butuh migration.

### 13.1 Tidak Perlu Migration

Biasanya tidak perlu jika:

- perubahan hanya untuk instance baru,
- instance lama boleh menyelesaikan versi lama,
- perubahan kosmetik label tidak mempengaruhi active instance,
- bug fix ada di Java delegate backward-compatible,
- history/reporting bisa menangani multiple versions,
- external integration tetap mendukung old topic/message.

Contoh:

```text
Flow application v3 masih valid untuk case lama.
Flow application v4 hanya untuk submission baru.
```

### 13.2 Perlu Migration

Mungkin perlu jika:

- versi lama punya bug fatal,
- regulatory rule mengharuskan semua active case mengikuti flow baru,
- old process tidak bisa selesai karena integration deprecated,
- task lama harus pindah ke new approval chain,
- SLA logic salah dan harus diperbaiki untuk running cases,
- process model lama menimbulkan dead path/incidents massal.

### 13.3 Jangan Migrate Jika Tidak Perlu

Migration membawa risiko:

- active tokens salah peta,
- timer hilang/berubah,
- event subscription berubah,
- variables tidak cocok,
- user task assignment berubah,
- audit story membingungkan,
- incident state berubah,
- operator salah interpretasi.

Rule senior:

> Default-nya biarkan old instances selesai di versi lama. Migrate hanya jika ada alasan business/operational yang jelas dan migration plan dapat dibuktikan aman.

---

## 14. Migration Plan Mental Model

Migration plan terdiri dari:

1. source process definition,
2. target process definition,
3. mapping instructions,
4. validation,
5. execution terhadap satu atau banyak process instances.

Pseudo-code:

```java
MigrationPlan migrationPlan = runtimeService
    .createMigrationPlan(sourceProcessDefinitionId, targetProcessDefinitionId)
    .mapActivities("review_case", "review_case")
    .mapActivities("approve_case", "approve_case_v2")
    .build();

runtimeService
    .newMigration(migrationPlan)
    .processInstanceIds(processInstanceIds)
    .execute();
```

Untuk banyak case:

```java
runtimeService
    .newMigration(migrationPlan)
    .processInstanceQuery(
        runtimeService.createProcessInstanceQuery()
            .processDefinitionId(sourceProcessDefinitionId)
            .active()
    )
    .executeAsync();
```

Catatan: API tepat bisa berbeda minor version; gunakan dokumentasi/Javadocs versi Camunda yang dipakai.

---

## 15. Activity Mapping Discipline

Mapping activity bukan sekadar nama sama.

Yang harus dicek:

- Apakah source activity dan target activity punya semantic yang sama?
- Apakah keduanya scope/non-scope compatible?
- Apakah boundary event berubah?
- Apakah event subscription compatible?
- Apakah user task candidate/assignee berubah?
- Apakah input/output mapping berubah?
- Apakah form key berubah?
- Apakah timer behavior berubah?
- Apakah multi-instance structure berubah?
- Apakah compensation/event subprocess terkait berubah?

### 15.1 Safe Mapping

Relatif aman:

```text
user_task_review -> user_task_review
```

Jika ID sama dan semantic sama.

### 15.2 Risky Mapping

Risky:

```text
embedded_subprocess_review -> call_activity_review
```

Karena scope structure berubah.

Risky:

```text
parallel_multi_instance_task -> sequential_multi_instance_task
```

Karena execution tree berubah.

Risky:

```text
user_task_review -> service_task_auto_approve
```

Karena human wait state berubah menjadi automated action.

### 15.3 No Mapping

Jika active execution berada di activity yang tidak dimapping dan target tidak punya equivalent, migration akan gagal atau harus menggunakan modification strategy terpisah.

---

## 16. Migration dengan User Task Aktif

User task aktif adalah salah satu migration target paling umum.

Contoh:

```text
v1: review_case
v2: review_case with updated form and candidate group
```

Pertanyaan:

1. Apakah task lama tetap dipertahankan?
2. Apakah task baru dibuat?
3. Apakah assignee tetap?
4. Apakah candidate group diperbarui?
5. Apakah form key berubah?
6. Apakah due date berubah?
7. Apakah existing task comments/attachments tetap terlihat?
8. Apakah user yang sedang membuka task terdampak?

Camunda migration memindahkan runtime state, tetapi tidak selalu memenuhi seluruh business expectation.

Untuk enterprise, siapkan post-migration script via API jika diperlukan:

- update task candidate group,
- update due date,
- set local variables,
- add comment,
- create business audit record.

Namun jangan update engine DB manual.

---

## 17. Migration dengan Timer Aktif

Timer migration lebih rumit karena timer adalah job.

Pertanyaan:

- Apakah source timer id sama?
- Apakah target timer definition sama?
- Apakah due date lama dipertahankan?
- Apakah timer baru perlu dihitung ulang?
- Apakah boundary timer interrupting/non-interrupting berubah?
- Apakah SLA policy berubah?

Contoh:

```text
v1: boundary timer P7D escalate to supervisor
v2: boundary timer P5D warn, P10D escalate
```

Migrating active timer dari v1 ke v2 bukan sekadar mapping. Secara business, kita harus tahu:

```text
Case yang sudah menunggu 6 hari harus dianggap bagaimana?
```

Pilihan:

1. Keep old timer due date.
2. Recalculate from original task create time.
3. Recalculate from migration time.
4. Cancel old and create new SLA state manually.

Ini policy, bukan teknis.

---

## 18. Migration dengan Event Subscription Aktif

Message catch, signal catch, conditional event, receive task, dan event-based gateway membuat event subscription.

Pertanyaan:

- Apakah message name tetap sama?
- Apakah correlation key tetap sama?
- Apakah event subscription activity id berubah?
- Apakah inbound integration masih mengirim event lama?
- Apakah event-based gateway structure berubah?

Jika migration salah, process bisa tidak menerima event yang seharusnya diterima.

Diagnostic query concept:

```sql
SELECT *
FROM ACT_RU_EVENT_SUBSCR
WHERE PROC_INST_ID_ = :processInstanceId;
```

Setelah migration, validasi event subscription aktif masih sesuai expected contract.

---

## 19. Migration dengan External Task Aktif

External task aktif ada di `ACT_RU_EXT_TASK`.

Pertanyaan:

- Apakah topic berubah?
- Apakah worker lama masih berjalan?
- Apakah lock sedang aktif?
- Apakah task sedang dikerjakan worker saat migration?
- Apakah retries dan error details harus dipertahankan?

Risiko:

```text
Worker sudah fetch-and-lock external task lama.
Migration dilakukan.
Worker complete dengan stale assumption.
```

Mitigasi:

- stop/pause workers untuk affected topics,
- tunggu locks expired atau handle graceful drain,
- migrate,
- validate external tasks,
- resume workers,
- monitor duplicate completion/failure.

---

## 20. Migration dengan Incidents

Incident menunjukkan process stuck atau failure state.

Sebelum migration:

1. klasifikasikan incident,
2. pahami root cause,
3. tentukan apakah target model memperbaiki root cause,
4. tentukan apakah job retries perlu reset,
5. tentukan apakah variable perlu diperbaiki,
6. tentukan apakah manual modification lebih cocok daripada migration.

Migrating incident tanpa root cause analysis bisa hanya memindahkan masalah ke definition baru.

Contoh:

```text
Incident: delegate fails because variable applicantType null.
Target model still calls same delegate.
Migration will not fix it.
```

Perlu variable remediation atau code fix.

---

## 21. Migration dan History/Audit

Migration mengubah runtime state, tetapi history lama tetap menunjukkan jejak activity versi lama.

Audit story harus mampu menjelaskan:

- process started under version X,
- migrated to version Y at timestamp T,
- migration initiated by actor/system,
- reason for migration,
- migration plan id/name,
- affected instances,
- mapping summary,
- post-migration validation result.

Camunda user operation log bisa membantu, tetapi untuk regulatory platform sebaiknya tetap ada domain/platform audit record khusus.

Contoh audit record:

```json
{
  "eventType": "PROCESS_INSTANCE_MIGRATED",
  "caseId": "CASE-2026-0001",
  "processInstanceId": "...",
  "sourceDefinitionKey": "enforcement_case_process",
  "sourceVersion": 3,
  "targetVersion": 4,
  "reasonCode": "REGULATORY_RULE_UPDATE_CR_1842",
  "initiatedBy": "system-admin-01",
  "approvedBy": "workflow-governance-board",
  "migrationBatchId": "MIG-2026-06-20-001",
  "validationStatus": "PASSED"
}
```

---

## 22. Migration Strategy Types

### 22.1 No Migration / Let Old Finish

```text
New cases use v2.
Old cases finish on v1.
```

Best when:

- v1 remains valid,
- old volume small,
- regulatory policy allows old handling,
- old integrations remain supported.

### 22.2 Forward Migration

```text
Active v1 instances moved to v2.
```

Best when:

- v1 broken or obsolete,
- new policy applies to active cases,
- mapping is straightforward,
- variables compatible or remediated.

### 22.3 Case-by-Case Migration

```text
Only selected instances are migrated.
```

Best when:

- only certain statuses affected,
- high-risk cases need special handling,
- migration requires business approval.

### 22.4 Dual Run

```text
Old process handles old cohort.
New process handles new cohort.
Shared reporting aggregates both.
```

Best when:

- v1 and v2 differ significantly,
- migration risk high,
- business can tolerate two versions.

### 22.5 Terminate and Restart

```text
Cancel old instance and start new process with reconstructed state.
```

Dangerous but sometimes necessary when:

- structure changed too much,
- migration impossible,
- state can be reconstructed safely,
- audit/legal approves cancellation/restart.

### 22.6 Process Modification Instead of Migration

Sometimes you do not need definition migration; you need instance modification.

Example:

```text
Move token from wrong activity to correct activity in same process definition.
```

Process instance modification can start/cancel activity instances, but it is operationally dangerous and must be audited.

---

## 23. Rolling Deployment Strategy

Camunda 7 deployments often happen together with Java application deployment.

### 23.1 Bad Rolling Deployment

```text
Node A: old app, old delegates
Node B: new app, new delegates, new BPMN
Job executor active on both
New BPMN deployed
Old node acquires job requiring new delegate
Failure
```

### 23.2 Safer Strategy for Embedded Engine

One conservative pattern:

1. Disable job executor on nodes during deployment, or control acquisition.
2. Deploy compatible code first if possible.
3. Deploy BPMN resources.
4. Ensure all nodes have required classes/beans/config.
5. Re-enable job executor.
6. Validate job acquisition.
7. Monitor incidents.

Alternative:

- use deployment-aware job executor,
- route jobs to nodes with deployment registered,
- make cluster homogeneous before enabling new jobs.

### 23.3 Backward-Compatible Code First

Often safest:

```text
Release A:
  Code can support old and new variables/contracts, but new BPMN not active yet.

Release B:
  Deploy new BPMN.

Release C:
  After old instances drain/migrate, remove old compatibility code.
```

This is the **expand-migrate-contract** pattern.

---

## 24. Expand-Migrate-Contract Pattern

This pattern is critical for long-running workflow.

### 24.1 Expand

Add code/model compatibility without breaking old instances.

Examples:

- delegate handles both `riskLevel` and `riskAssessment.level`,
- worker supports old and new topic temporarily,
- UI can render old and new form keys,
- DMN can handle missing new field with explicit default policy.

### 24.2 Migrate

Migrate selected running instances or let old instances drain.

Actions:

- run migration plan,
- backfill variables,
- update task metadata,
- validate subscriptions/jobs/tasks,
- record audit.

### 24.3 Contract

Remove old compatibility after safe point.

Safe only when:

- no runtime instances on old version,
- no jobs/external tasks/messages for old contract,
- history/reporting adjusted,
- rollback plan no longer depends on old code.

---

## 25. Environment Consistency: DEV/UAT/PROD Version Drift

Numeric process definition version can drift across environments.

Example:

```text
DEV: enforcement_case_process version 12
UAT: enforcement_case_process version 7
PROD: enforcement_case_process version 5
```

If a migration script says:

```text
migrate version 5 to version 6
```

It may mean different definitions across environments.

Better identify definitions by:

- key,
- version tag,
- deployment name/source,
- checksum/hash of BPMN resource,
- release id,
- deployment id per environment resolved dynamically.

### 25.1 Recommended Deployment Metadata

Use deployment name/source convention:

```text
Deployment name: aceas-workflow-2026.06.20-cr1842
Deployment source: git:abc1234 pipeline:build-982 env:prod
Version tag: 2026.06.CR1842
```

Maintain external release registry:

| Env | Process Key | Version Tag | Engine Version | Deployment Id | Git SHA | Deployed At |
|---|---|---|---:|---|---|---|
| UAT | enforcement_case_process | 2026.06.CR1842 | 8 | dep-uat-123 | abc123 | ... |
| PROD | enforcement_case_process | 2026.06.CR1842 | 5 | dep-prod-987 | abc123 | ... |

---

## 26. BPMN ID Governance

BPMN ID is not cosmetic.

IDs affect:

- migration mapping,
- incidents,
- activity instance tree,
- history queries,
- Cockpit diagnostics,
- call stack/log correlation,
- external documentation,
- task analytics,
- process modification,
- reporting.

### 26.1 ID Naming Policy

Prefer stable semantic IDs:

```text
review_case
request_additional_documents
approve_enforcement_action
send_notice_of_intent
wait_for_applicant_response
```

Avoid generated IDs:

```text
Activity_0x8s9ab
Gateway_1p9k2zz
```

Generated IDs make migration and audit painful.

### 26.2 Rename Policy

Allowed:

```text
name changes, id remains.
```

Dangerous:

```text
id changes only because business label changed.
```

If ID must change, migration plan must explicitly map old to new.

---

## 27. Variable Migration

Process instance migration does not magically transform variables into new schema.

### 27.1 Variable Versioning

Use explicit variable schema version.

Example:

```json
{
  "schemaVersion": 2,
  "caseId": "CASE-001",
  "risk": {
    "level": "HIGH",
    "score": 87
  }
}
```

### 27.2 Pre-Migration Backfill

Before process migration:

```java
runtimeService.setVariable(processInstanceId, "agencyCode", "CEA");
runtimeService.setVariable(processInstanceId, "casePayloadSchemaVersion", 2);
```

But do not blindly set data. For regulatory systems, the source and reason must be audited.

### 27.3 Lazy Migration

Delegate detects old schema and upgrades at runtime.

Pros:

- no big batch,
- only active path upgraded.

Cons:

- hidden side effect,
- harder to audit,
- repeated complexity in code.

### 27.4 Explicit Migration Task

Model includes technical migration step.

Pros:

- visible in process history,
- auditable,
- controlled.

Cons:

- process complexity,
- may expose technical detail to business model.

---

## 28. Migration Validation Checklist

Before migration:

### 28.1 Definition Validation

- Source and target process definitions identified exactly.
- BPMN XML source/target archived.
- Version tag verified.
- Deployment id verified.
- Activity id diff generated.
- Gateway/subprocess/multi-instance changes reviewed.
- Boundary events reviewed.
- Timer changes reviewed.
- Message/signal events reviewed.
- Call activity and DMN binding reviewed.

### 28.2 Runtime Cohort Validation

- Number of candidate instances counted.
- Active activity distribution known.
- Active user tasks known.
- Active jobs known.
- Active external tasks known.
- Active event subscriptions known.
- Active incidents known.
- Suspended instances excluded or handled deliberately.

### 28.3 Variable Validation

- Required new variables exist or can be derived.
- Deprecated variables still supported.
- Serialized object variables checked.
- JSON schema version checked.
- Large variables considered.
- PII/security impact checked.

### 28.4 Operational Validation

- Workers paused/drained if needed.
- Job executor strategy decided.
- Maintenance window approved.
- Backup/restore point available.
- Rollback plan defined.
- Operator dashboard ready.
- Audit record plan ready.

### 28.5 Post-Migration Validation

- Instance count migrated.
- Activity distribution matches expectation.
- No unexpected incidents.
- Jobs due dates valid.
- Event subscriptions valid.
- User task assignee/candidate/form valid.
- External tasks topics valid.
- Sample cases manually inspected.
- Business audit records created.

---

## 29. SQL Diagnostics for Versioning and Migration

These SQL snippets are diagnostic only. Do not mutate Camunda tables manually.

### 29.1 Process Definitions by Key

```sql
SELECT ID_, KEY_, VERSION_, VERSION_TAG_, DEPLOYMENT_ID_, RESOURCE_NAME_, DGRM_RESOURCE_NAME_
FROM ACT_RE_PROCDEF
WHERE KEY_ = :processKey
ORDER BY VERSION_ DESC;
```

### 29.2 Runtime Instances by Definition

```sql
SELECT PROC_DEF_ID_, COUNT(*) AS CNT
FROM ACT_RU_EXECUTION
WHERE PARENT_ID_ IS NULL
GROUP BY PROC_DEF_ID_
ORDER BY CNT DESC;
```

### 29.3 Active Activity Distribution

Depending on DB/vendor and runtime structure, use engine API for exact activity instance tree. SQL approximation:

```sql
SELECT PROC_DEF_ID_, ACT_ID_, COUNT(*) AS CNT
FROM ACT_RU_EXECUTION
WHERE ACT_ID_ IS NOT NULL
GROUP BY PROC_DEF_ID_, ACT_ID_
ORDER BY PROC_DEF_ID_, CNT DESC;
```

### 29.4 Active User Tasks by Definition

```sql
SELECT E.PROC_DEF_ID_, T.TASK_DEF_KEY_, COUNT(*) AS CNT
FROM ACT_RU_TASK T
JOIN ACT_RU_EXECUTION E ON T.EXECUTION_ID_ = E.ID_
GROUP BY E.PROC_DEF_ID_, T.TASK_DEF_KEY_
ORDER BY CNT DESC;
```

### 29.5 Active Jobs by Definition

```sql
SELECT PROCESS_DEF_ID_, HANDLER_TYPE_, COUNT(*) AS CNT
FROM ACT_RU_JOB
GROUP BY PROCESS_DEF_ID_, HANDLER_TYPE_
ORDER BY CNT DESC;
```

### 29.6 Event Subscriptions by Definition

```sql
SELECT E.PROC_DEF_ID_, S.EVENT_TYPE_, S.EVENT_NAME_, S.ACTIVITY_ID_, COUNT(*) AS CNT
FROM ACT_RU_EVENT_SUBSCR S
JOIN ACT_RU_EXECUTION E ON S.EXECUTION_ID_ = E.ID_
GROUP BY E.PROC_DEF_ID_, S.EVENT_TYPE_, S.EVENT_NAME_, S.ACTIVITY_ID_
ORDER BY CNT DESC;
```

---

## 30. Java API Example: Resolve Definitions by Version Tag

Conceptual example:

```java
ProcessDefinition source = repositoryService
    .createProcessDefinitionQuery()
    .processDefinitionKey("enforcement_case_process")
    .versionTag("2026.05.CR1701")
    .singleResult();

ProcessDefinition target = repositoryService
    .createProcessDefinitionQuery()
    .processDefinitionKey("enforcement_case_process")
    .versionTag("2026.06.CR1842")
    .singleResult();

if (source == null || target == null) {
    throw new IllegalStateException("Source or target definition not found");
}
```

Important production considerations:

- handle duplicate version tags,
- validate tenant id,
- validate deployment source,
- validate BPMN checksum,
- log resolved ids,
- never hardcode PROD definition ids from UAT.

---

## 31. Java API Example: Build and Validate Migration Plan

Conceptual:

```java
MigrationPlan plan = runtimeService
    .createMigrationPlan(source.getId(), target.getId())
    .mapActivities("review_case", "review_case")
    .mapActivities("approve_case", "approve_case")
    .mapActivities("wait_for_response", "wait_for_response")
    .build();
```

For simple case, Camunda also supports mapping equal activity ids in certain APIs/features, but production migration should still review mapping deliberately.

Danger:

```text
Same ID does not always mean same business meaning.
Different ID does not always mean different business meaning.
```

ID matching is a starting point, not final validation.

---

## 32. Java API Example: Migrate Selected Cohort

Conceptual:

```java
List<String> processInstanceIds = runtimeService
    .createProcessInstanceQuery()
    .processDefinitionId(source.getId())
    .active()
    .list()
    .stream()
    .map(ProcessInstance::getId)
    .toList();

runtimeService
    .newMigration(plan)
    .processInstanceIds(processInstanceIds)
    .execute();
```

For Java 8 compatibility:

```java
List<String> processInstanceIds = runtimeService
    .createProcessInstanceQuery()
    .processDefinitionId(source.getId())
    .active()
    .list()
    .stream()
    .map(ProcessInstance::getId)
    .collect(Collectors.toList());
```

Production considerations:

- batch size,
- async migration for large cohorts,
- maintenance window,
- retry strategy,
- audit per batch,
- dry run in UAT with production-like data shape.

---

## 33. Migration as a Release Artifact

Treat migration script as code.

Repository structure example:

```text
workflow/
  bpmn/
    enforcement_case_process.bpmn
  dmn/
    risk_decision.dmn
  migrations/
    2026-06-cr1842/
      migration-plan.md
      activity-mapping.csv
      precheck.sql
      postcheck.sql
      migrate.java
      rollback-plan.md
      test-cases.md
```

### 33.1 Activity Mapping CSV

```csv
sourceActivityId,targetActivityId,reason,risk,notes
review_case,review_case,same semantic,low,label changed only
approve_case,approve_enforcement_action,renamed approval step,medium,task form changed
wait_for_response,wait_for_response,same event wait,low,message name unchanged
```

### 33.2 Migration Plan Review

Require sign-off from:

- tech lead,
- workflow/domain owner,
- QA,
- operations,
- compliance/audit if regulatory,
- product/business owner if process semantics changed.

---

## 34. Rollback Thinking

Rollback of workflow migration is not like redeploying old jar.

Question:

```text
If migration partially succeeds, how do we recover?
```

Options:

1. migrate back to old definition,
2. fix variables and continue new definition,
3. suspend affected instances,
4. manually modify instances,
5. cancel and restart selected cases,
6. operator remediation.

Each option must be pre-approved.

### 34.1 Before Migration Backup

At minimum:

- DB backup/snapshot,
- list of affected process instance ids,
- source/target definitions archived,
- variable snapshot for affected instances if practical,
- task/job/event subscription snapshot,
- audit batch id.

DB restore is usually last resort because it affects more than migrated process instances.

---

## 35. Versioning Anti-Patterns

### 35.1 Deploying Every Save

Every small BPMN save creates new version in shared environments.

Impact:

- version noise,
- deployment cache churn,
- confusing audits,
- migration ambiguity.

Use CI/CD discipline.

### 35.2 Generated Activity IDs

Impact:

- unreadable incidents,
- fragile migration,
- poor audit.

### 35.3 Latest Binding Everywhere

Impact:

- old parent instances accidentally use new child/decision,
- hard-to-reproduce behavior,
- audit confusion.

### 35.4 Java Serialization for Long-Running Variables

Impact:

- class compatibility risk,
- migration pain,
- REST client pain,
- security concern.

### 35.5 Removing Old Delegate Compatibility Too Soon

Impact:

- old process instances fail when reaching old service task,
- incidents after deployment,
- rollback complexity.

### 35.6 Migration Without Runtime Cohort Analysis

Impact:

- unexpected activity structures,
- failed migration,
- lost operator trust.

### 35.7 Manual DB Update

Impact:

- corrupted runtime state,
- broken optimistic locking,
- hidden audit gap,
- unsupported behavior.

---

## 36. Regulatory Workflow Example

Scenario:

```text
A regulatory agency has an enforcement case process.
Version 3:
  - intake
  - initial review
  - officer assessment
  - manager approval
  - notice generation
  - wait for response
  - closure

Version 4 adds:
  - risk screening before officer assessment
  - additional legal review for HIGH risk
  - new SLA escalation after 10 working days
```

### 36.1 Business Policy Decision

Questions:

1. Do active cases need risk screening?
2. Do cases already past officer assessment need legal review?
3. Does new SLA apply from original task date or deployment date?
4. Do old notices remain valid?
5. Does audit need to state process version change?

Possible policy:

```text
- New cases use v4.
- Active cases before officer assessment migrate to v4.
- Active cases already at manager approval remain on v3.
- Cases with HIGH risk but already approved require separate manual review subprocess.
```

### 36.2 Technical Cohorts

Cohort A:

```text
Active at initial_review -> migrate to v4 initial_review
```

Cohort B:

```text
Active at officer_assessment -> migrate to v4 risk_screening or officer_assessment depending policy
```

Cohort C:

```text
Active at manager_approval -> no migration
```

Cohort D:

```text
Active at wait_for_response -> no migration, because notice already issued
```

### 36.3 Audit Record

For migrated cases:

```text
Case migrated from process version 3 to version 4 under CR-1842 due to regulatory risk screening requirement. Migration applied only to cases not yet past officer assessment. Existing issued notices were not changed.
```

This is defensible because migration policy is explicit.

---

## 37. Production Playbook: Safe Process Migration

### Phase 1 — Analyze

1. Export source and target BPMN.
2. Diff XML and model diagram.
3. Identify active runtime distribution.
4. Identify activity ids changed.
5. Identify variable contract changes.
6. Identify task/form changes.
7. Identify timers/events/external tasks.
8. Identify incidents.
9. Define business migration policy.

### Phase 2 — Prepare

1. Write migration plan.
2. Write precheck SQL/API script.
3. Write variable backfill script if needed.
4. Write postcheck SQL/API script.
5. Prepare audit records.
6. Prepare rollback/remediation plan.
7. Test in lower environment.
8. Rehearse with production-like data.

### Phase 3 — Execute

1. Announce maintenance window if needed.
2. Pause/drain workers/job executor if needed.
3. Run precheck.
4. Backfill variables.
5. Execute migration batch.
6. Run postcheck.
7. Resume workers/job executor.
8. Monitor incidents/jobs/tasks/events.

### Phase 4 — Stabilize

1. Validate sample business cases.
2. Review failed migrations.
3. Resolve incidents.
4. Publish migration report.
5. Keep compatibility code until old instances drain.
6. Schedule cleanup/removal later.

---

## 38. Java 8–25 Considerations

Camunda 7 estates often span older Java versions.

### 38.1 Java 8

Common in legacy Camunda 7 deployments.

Considerations:

- no `List.toList()`, use `Collectors.toList()`.
- date/time API exists but legacy code may use `Date`.
- avoid modern language constructs.
- older Spring Boot/Camunda starter combinations.

### 38.2 Java 11/17

Good modernization targets for many Camunda 7 systems.

Considerations:

- stronger module/classpath awareness,
- dependency compatibility,
- app server support,
- TLS/security defaults.

### 38.3 Java 21

Possible in newer supported environments depending exact Camunda distribution/version and enterprise/community constraints. Validate official support matrix for your Camunda version.

Considerations:

- Spring Boot generation compatibility,
- Jakarta vs javax friction,
- runtime container image,
- bytecode target,
- dependency graph.

### 38.4 Java 25

Treat Java 25 as future/runtime planning, not assumed supported by Camunda 7 unless official support matrix says so.

Engineering stance:

```text
You can write migration tooling or external workers on newer Java if they interact via REST/API, but embedded engine runtime must follow Camunda-supported Java versions.
```

---

## 39. Top 1% Mental Models

### 39.1 Deployment Is Publication, Not Mutation of Running Reality

Deploying new BPMN publishes new process definition version. It does not rewrite active process state.

### 39.2 Versioning Is Multi-Layer

You version:

- BPMN,
- DMN,
- Java code,
- worker contract,
- REST/message schema,
- form/UI,
- variables,
- business policy,
- audit/reporting.

If only BPMN is versioned, the system is still not fully versioned.

### 39.3 Migration Is a Business Operation with Technical Mechanism

Technical mapping is necessary but insufficient. Migration needs policy, approval, audit, validation, and rollback thinking.

### 39.4 Activity IDs Are Public Contracts

For long-running workflow, BPMN element IDs are operational API.

### 39.5 Default to Compatibility, Not Big Bang

Use expand-migrate-contract. Long-running systems survive by compatibility windows.

### 39.6 Let Old Instances Finish Unless There Is a Reason

Migration has risk. Avoid it when coexistence is safe.

---

## 40. Quick Self-Test

Answer these before moving to next part:

1. What is the difference between process definition key, version, id, and version tag?
2. Why does deploying a new BPMN not affect running instances automatically?
3. Why can BPMN versioning fail to protect old instances from Java delegate behavior changes?
4. When is `latest` binding dangerous for call activity/DMN?
5. Why are generated BPMN activity IDs harmful?
6. What runtime states must be inspected before migration?
7. Why can active timers make migration semantically complex?
8. Why should migration be audited as a business/platform operation?
9. What is expand-migrate-contract?
10. Why is manual mutation of Camunda tables unsafe?

---

## 41. References

- Camunda 7 Manual — Process Instance Migration: https://docs.camunda.org/manual/7.24/user-guide/process-engine/process-instance-migration/
- Camunda 7 Manual — Database Schema: https://docs.camunda.org/manual/7.24/user-guide/process-engine/database/database-schema/
- Camunda 7 Manual — Transactions in Processes: https://docs.camunda.org/manual/7.24/user-guide/process-engine/transactions-in-processes/
- Camunda 7 Manual — Job Executor: https://docs.camunda.org/manual/7.24/user-guide/process-engine/the-job-executor/
- Camunda 7 Manual — External Tasks: https://docs.camunda.org/manual/7.24/user-guide/process-engine/external-tasks/
- Camunda 7 Manual — Process Variables: https://docs.camunda.org/manual/7.24/user-guide/process-engine/variables/
- Camunda 7 Manual — Timer Events: https://docs.camunda.org/manual/7.24/reference/bpmn20/events/timer-events/
- Camunda 7 Javadocs — RuntimeService and migration-related APIs: https://docs.camunda.org/javadoc/camunda-bpm-platform/7.24/
- Camunda 8 Docs — Migrating from Camunda 7, for later comparison only: https://docs.camunda.io/docs/guides/migrating-from-camunda-7/

---

## 42. Penutup

Part ini membangun fondasi untuk memahami perubahan proses sebagai **evolution of durable state**, bukan sekadar update diagram.

Camunda 7 membuat workflow menjadi persisted runtime object. Karena itu, setiap perubahan model harus dijawab dengan pertanyaan:

```text
Apakah perubahan ini hanya berlaku untuk instance baru,
atau juga harus mengubah state instance lama yang sedang berjalan?
```

Jika jawabannya “instance lama juga harus berubah”, maka kita masuk wilayah migration, dan migration harus diperlakukan sebagai operasi production yang serius: dianalisis, dites, diaudit, dieksekusi terkontrol, dan divalidasi.

Di part berikutnya kita akan membahas **multi-tenancy, engine partitioning, authorization boundary, dan shared platform design**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-017.md">⬅️ Part 017 — Incidents, Error Taxonomy, BPMN Error, Escalation, Compensation, dan Recovery Semantics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-019.md">Part 019 — Multi-Tenancy, Engine Partitioning, Authorization Boundary, dan Shared Platform Design ➡️</a>
</div>
