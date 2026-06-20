# learn-java-camunda-7-bpm-platform-engineering-part-016.md

# Part 016 — History, Auditability, Regulatory Traceability, dan Data Retention

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Bagian: `016 / 035`  
> Fokus: Camunda 7 history event stream, audit log, history tables, user operation log, traceability, retention, cleanup, dan strategi defensibilitas untuk sistem enterprise/regulatory.  
> Target pembaca: Java engineer/tech lead yang harus membangun, mengoperasikan, mengaudit, dan mempertahankan workflow platform berbasis Camunda 7 di produksi.

---

## 1. Posisi Materi Ini Dalam Seri

Pada part sebelumnya kita sudah membangun fondasi penting:

- runtime state disimpan di `ACT_RU_*`,
- execution tree menjelaskan state aktif process instance,
- wait state adalah durability boundary,
- job executor melanjutkan pekerjaan asynchronous,
- variable bukan sekadar `Map<String, Object>`,
- user task adalah durable human-controlled state transition.

Sekarang kita masuk ke sisi yang berbeda: **apa yang tersisa setelah proses berjalan?**

Di Camunda 7, jawaban sederhananya adalah **history**.

Tetapi untuk engineer senior, jawaban itu belum cukup. Kita harus membedakan:

1. **runtime truth** — state aktif yang diperlukan engine untuk melanjutkan proses;
2. **history truth** — event/audit projection yang menjelaskan apa yang pernah terjadi;
3. **business truth** — catatan domain yang secara hukum/operasional menjadi bukti keputusan;
4. **operator truth** — catatan tindakan manual seperti modification, suspension, restart, job retry, dan task operation;
5. **retention truth** — aturan berapa lama data boleh/wajib disimpan dan kapan harus dihapus.

Kesalahan besar di banyak implementasi workflow adalah menganggap Camunda history otomatis menjadi audit trail final untuk semua kebutuhan bisnis/regulatory. Itu berbahaya.

Camunda history sangat berguna, tetapi ia adalah **technical process audit stream**, bukan otomatis menjadi **complete legal evidence ledger**.

---

## 2. Mental Model Utama

Camunda 7 history sebaiknya dipahami sebagai:

```text
Runtime execution happens
        |
        v
History events are produced
        |
        v
Default history event handler writes to ACT_HI_*
        |
        v
HistoryService / REST / Cockpit / custom reports read historic projection
```

Runtime engine tidak bergantung pada history database untuk melanjutkan proses. Camunda documentation menyatakan bahwa BPMN core engine tidak membaca state dari history database; history event stream dapat ditulis ke default history database atau backend custom. Artinya, history adalah **projection/audit stream**, bukan sumber runtime state.

Konsekuensinya:

- corrupt/beratnya history table bisa membuat sistem lambat, tetapi runtime process semantics tidak “dihitung dari history”;
- menghapus history tidak otomatis membatalkan process instance;
- history bisa disesuaikan levelnya;
- untuk audit regulatory, history harus dilengkapi dengan domain audit, security audit, document/evidence store, dan user operation context.

---

## 3. Runtime State vs History State

Perbedaan ini harus tertanam kuat.

| Aspek | Runtime | History |
|---|---|---|
| Prefix tabel | `ACT_RU_*` | `ACT_HI_*` |
| Fungsi | Melanjutkan process aktif | Merekam apa yang terjadi |
| Umur data | Hilang saat instance selesai / state pindah | Bertahan setelah instance selesai sampai cleanup/deletion |
| Dipakai engine untuk execution? | Ya | Tidak untuk BPMN core execution |
| Query API utama | `RuntimeService`, `TaskService`, `ManagementService` | `HistoryService` |
| Cocok untuk | operational state | audit, reporting, diagnosis, forensic |
| Risiko utama | corrupt runtime = proses rusak | unbounded growth = storage/performance problem |

Contoh:

```text
User task aktif:
  ACT_RU_TASK        -> ada
  ACT_RU_EXECUTION   -> ada
  ACT_HI_TASKINST    -> biasanya ada/updated sesuai history level

User task selesai:
  ACT_RU_TASK        -> hilang
  ACT_RU_EXECUTION   -> lanjut ke state berikutnya / selesai
  ACT_HI_TASKINST    -> tetap ada sebagai catatan historis
```

Jangan membuat reporting jangka panjang dari `ACT_RU_*`. Runtime table adalah working memory engine, bukan warehouse.

---

## 4. Apa Itu History Event Stream?

Camunda menghasilkan **history events** ketika hal tertentu terjadi:

- process instance start/end/update/migrate,
- activity instance start/end,
- task create/update/complete/delete,
- variable create/update/delete,
- form property update,
- incident create/delete/resolve,
- job log create/fail/success/delete,
- external task log create/fail/success/delete,
- decision evaluation,
- batch start/end,
- identity link add/delete,
- user operation log event.

Event ini kemudian ditangani oleh history event handler.

Default-nya:

```text
History Event Stream
        |
        v
DbHistoryEventHandler
        |
        v
ACT_HI_* tables
```

Tetapi Camunda memungkinkan custom implementation untuk history event producer/handler. Ini membuka opsi:

- menulis event ke audit database terpisah,
- publish event ke log/audit pipeline,
- enrich event dengan metadata organisasi,
- filtering event tertentu,
- membangun compliance projection.

Namun custom history handler bukan keputusan ringan. Ia menyentuh jalur sensitif engine dan bisa berdampak ke performance, transaction behavior, upgrade compatibility, dan forensic correctness.

---

## 5. History Level

History level menentukan berapa banyak event yang dibuat dan ditulis.

Camunda 7 menyediakan level utama:

1. `none`
2. `activity`
3. `audit`
4. `full`
5. `auto`
6. custom history level

### 5.1 `none`

Tidak ada history event yang disimpan.

Cocok untuk:

- benchmark tertentu,
- test internal yang tidak butuh audit,
- engine khusus yang hanya menjadi transient orchestrator dan audit ditangani total di tempat lain.

Tidak cocok untuk:

- human workflow,
- regulatory case management,
- enterprise approval,
- incident diagnosis,
- SLA reporting,
- post-mortem.

### 5.2 `activity`

Menyimpan event aktivitas dasar:

- process instance lifecycle,
- activity instance lifecycle,
- task instance lifecycle.

Ini memberi timeline proses, tetapi tidak cukup untuk audit variabel dan keputusan detail.

### 5.3 `audit`

Menambahkan variable instance events di atas `activity`.

Ini sering menjadi default yang masuk akal untuk banyak sistem, karena kita bisa melihat latest variable state. Tetapi ada nuance penting:

- historic variable instance biasanya menyimpan **latest value**, bukan semua intermediate changes;
- untuk melihat perubahan intermediate variable, perlu `full` atau strategy custom/domain audit;
- menyimpan variable berarti menyimpan data bisnis, PII, payload besar, dan potensi data sensitif.

### 5.4 `full`

Menambahkan detail yang jauh lebih lengkap:

- form property update,
- historic variable updates,
- user operation log,
- incident lifecycle,
- historic job log,
- DMN decision instance,
- batch lifecycle,
- identity link changes,
- external task log.

`full` cocok untuk:

- forensic-heavy environment,
- compliance/regulatory workflow,
- advanced Cockpit usage,
- deep debugging,
- audit-heavy operation.

Tetapi `full` mahal:

- storage naik signifikan,
- write amplification naik,
- cleanup menjadi wajib,
- variable updates bisa sangat besar,
- sensitive data exposure meningkat.

### 5.5 `auto`

`auto` berguna ketika beberapa engine berbagi database yang sama. Engine membaca history level dari database agar konfigurasi tidak divergen.

Ini penting untuk cluster multi-node: semua node harus punya history level konsisten.

### 5.6 Custom History Level

Custom history level bisa dibuat jika butuh granularitas lebih spesifik.

Contoh kebutuhan:

- simpan task + incident + job log, tetapi jangan simpan semua variable update;
- simpan only selected variable names;
- simpan process timeline tetapi exclude payload sensitif.

Namun custom history level harus diperlakukan sebagai platform extension serius:

- harus diuji lintas upgrade,
- harus terdokumentasi,
- harus konsisten di semua node,
- harus punya regression test untuk setiap process pattern.

---

## 6. History Level Bukan Sekadar “More Audit = Better”

Premis lemah yang harus ditolak:

> “Pakai `FULL` saja supaya audit lengkap.”

Masalahnya: `FULL` memang memberi lebih banyak data, tetapi tidak otomatis memberi audit yang benar secara bisnis.

Audit yang benar harus menjawab:

- siapa melakukan apa?
- kapan?
- berdasarkan authority apa?
- dari state bisnis apa ke state bisnis apa?
- dengan evidence apa?
- melalui channel apa?
- apakah ada approval/delegation?
- apakah ada override?
- apakah data yang dilihat user saat memutuskan bisa direkonstruksi?
- apakah perubahan setelah keputusan bisa dibedakan dari data saat keputusan?
- apakah retention dan deletion legal terpenuhi?

Camunda history membantu menjawab sebagian, tetapi tidak semuanya.

Maka desain yang lebih kuat:

```text
Camunda History
  -> process/activity/task/job/incident technical audit

Domain Audit Table
  -> business decision, actor, role, legal authority, before/after, reason

Document/Evidence Store
  -> immutable or versioned supporting files/evidence

Security Audit
  -> login, impersonation, permission checks, failed access

Integration Audit
  -> outbound/inbound commands/events, correlation id, remote status
```

Camunda history adalah satu layer, bukan keseluruhan evidence model.

---

## 7. History Entities Penting

Camunda documentation mencantumkan banyak history entities. Kita akan lihat yang paling penting untuk engineering.

### 7.1 Historic Process Instance

Representasi historis process instance.

Biasanya memuat:

- process instance id,
- process definition id/key/name/version,
- business key,
- start time,
- end time,
- duration,
- start user id,
- delete reason,
- state,
- removal time,
- tenant id.

Gunanya:

- mencari case/process yang selesai,
- melihat duration,
- audit high-level lifecycle,
- report SLA overall,
- cleanup berdasarkan TTL/removal time.

Query contoh:

```java
List<HistoricProcessInstance> instances = historyService
    .createHistoricProcessInstanceQuery()
    .processDefinitionKey("enforcement_case")
    .finished()
    .orderByProcessInstanceEndTime()
    .desc()
    .listPage(0, 50);
```

### 7.2 Historic Activity Instance

Merekam activity execution:

- user task,
- service task,
- gateway,
- event,
- subprocess,
- call activity,
- multi-instance body.

Gunanya:

- reconstruct path,
- identify bottleneck,
- see which step failed/ran,
- compare expected vs actual route.

Contoh forensic:

```java
List<HistoricActivityInstance> path = historyService
    .createHistoricActivityInstanceQuery()
    .processInstanceId(processInstanceId)
    .orderByHistoricActivityInstanceStartTime()
    .asc()
    .list();
```

Activity history tidak selalu sama dengan business timeline. Gateway/activity internal bisa muncul. Untuk user-facing timeline, biasanya perlu projection custom.

### 7.3 Historic Task Instance

Merekam user task lifecycle.

Penting untuk:

- assignee history,
- task start/end/duration,
- due date,
- delete reason,
- process context,
- ownership analysis,
- queue performance.

Tetapi untuk regulatory audit, task completion saja tidak cukup. Anda perlu tahu **decision payload**.

Contoh:

```java
List<HistoricTaskInstance> tasks = historyService
    .createHistoricTaskInstanceQuery()
    .processInstanceId(processInstanceId)
    .orderByHistoricTaskInstanceEndTime()
    .asc()
    .list();
```

### 7.4 Historic Variable Instance

Menyimpan latest value variable, tergantung history level.

Risiko:

- sensitive data tersimpan lama,
- large JSON/object memperbesar DB,
- query by variable lambat bila tidak hati-hati,
- serialized object menyulitkan migration,
- value latest bisa tidak mencerminkan nilai saat task decision dibuat.

Policy yang disarankan:

```text
Process variable:
  - small routing facts
  - ids/references
  - versioned snapshots bila diperlukan

Domain/audit table:
  - full business decision
  - immutable decision payload
  - before/after state
  - reason and evidence references
```

### 7.5 Historic Detail

Pada history level `full`, Camunda bisa menyimpan detail seperti variable updates.

Ini berguna untuk forensic, tetapi bisa sangat mahal.

Contoh:

```java
List<HistoricDetail> details = historyService
    .createHistoricDetailQuery()
    .processInstanceId(processInstanceId)
    .variableUpdates()
    .orderByTime()
    .asc()
    .list();
```

Gunakan dengan hati-hati:

- jangan load detail tanpa pagination,
- jangan expose semua value ke UI,
- jangan gunakan sebagai primary event store bisnis,
- jangan simpan payload besar tanpa retention strategy.

### 7.6 Historic Incident

Merekam incident current/past.

Penting untuk:

- operational audit,
- SLA incident review,
- retry failure analysis,
- reliability metrics.

Namun incident tidak selalu berarti business failure. Ia sering berarti technical recovery required.

### 7.7 Historic Job Log

Merekam lifecycle job:

- created,
- failed,
- successful,
- deleted.

Ini sangat berguna untuk:

- melihat retry history,
- debugging async continuation,
- timer execution,
- job executor issue,
- cleanup job behavior.

Tetapi job log juga bisa tumbuh besar. Cleanup untuk historic job log harus diperhatikan, termasuk job log yang dihasilkan history cleanup sendiri.

### 7.8 Historic External Task Log

Merekam external task lifecycle:

- created,
- failed,
- successful,
- deleted.

Penting untuk worker fleet audit:

- worker id,
- failure message,
- retries,
- topic,
- lock/execution behavior.

Tetapi jangan anggap ini menggantikan integration audit. Remote API response, idempotency key, request/response metadata, dan correlation id tetap lebih baik dicatat di integration audit table/log.

### 7.9 Historic Decision Instance

Untuk DMN:

- decision evaluated,
- input values,
- output values,
- decision definition/version.

Dalam sistem regulasi, decision history bisa sensitif. Ia bisa berisi alasan eligibility, risk score, atau classification.

Policy:

- jangan simpan PII berlebihan sebagai DMN input jika tidak perlu;
- version decision tables;
- capture decision context id;
- capture rule hit/output in business audit bila perlu defensibility.

### 7.10 User Operation Log

User operation log mencatat banyak operasi API yang dilakukan dalam context logged-in user. Untuk memakai operation log, history level harus `FULL`.

Contoh operasi:

- task claim,
- task assign,
- task complete,
- task delegate,
- task resolve,
- process instance suspension,
- modification,
- restart,
- job retries change,
- batch operations.

Operation log entity biasanya punya:

- operation id,
- operation type,
- entity type,
- category,
- annotation,
- entity ids,
- user id,
- timestamp,
- changed property,
- old value,
- new value.

Ini penting untuk operator audit. Tetapi ada batasan: operasi dicatat ketika dilakukan dalam context logged-in user. Untuk service-to-service automation, user context bisa kosong/technical unless explicitly managed.

---

## 8. History Tables: Peta Cepat

Tabel dapat berubah antar versi, tetapi peta umum Camunda 7:

| Tabel | Makna umum |
|---|---|
| `ACT_HI_PROCINST` | historic process instances |
| `ACT_HI_ACTINST` | historic activity instances |
| `ACT_HI_TASKINST` | historic task instances |
| `ACT_HI_VARINST` | latest historic variable values |
| `ACT_HI_DETAIL` | detailed updates, especially variable/form details |
| `ACT_HI_INCIDENT` | historic incidents |
| `ACT_HI_JOB_LOG` | historic job lifecycle |
| `ACT_HI_EXT_TASK_LOG` | historic external task lifecycle |
| `ACT_HI_OP_LOG` | user operation log |
| `ACT_HI_IDENTITYLINK` | historic identity link events |
| `ACT_HI_DECINST` | historic decision instances |
| `ACT_HI_BATCH` | historic batch metadata |

Rule penting:

> Query via `HistoryService` atau REST API lebih aman daripada bergantung langsung pada schema SQL untuk aplikasi utama.

SQL boleh untuk:

- diagnosis,
- DBA capacity planning,
- ad-hoc forensic,
- cleanup verification,
- custom reporting read-only dengan kontrak versi jelas.

SQL tidak boleh untuk:

- mutation manual sembarangan,
- task completion,
- retry job,
- process migration,
- update variable,
- business operation.

---

## 9. Auditability: Apa Yang Bisa dan Tidak Bisa Dibuktikan

### 9.1 Bisa Dibantu Camunda History

Camunda history bisa membantu membuktikan:

- process instance pernah dimulai,
- process pernah mencapai activity tertentu,
- task pernah dibuat,
- task pernah selesai,
- siapa assignee task terakhir,
- variable latest value atau update history, tergantung level,
- job pernah gagal/retry,
- incident pernah terjadi,
- external task pernah gagal/sukses,
- operator/user melakukan operasi tertentu, bila operation log aktif dan user context ada,
- decision DMN dievaluasi, bila history level/DMN history mendukung.

### 9.2 Tidak Otomatis Dibuktikan

Camunda history tidak otomatis membuktikan:

- user benar-benar melihat semua evidence sebelum memutuskan,
- role user valid menurut business policy saat itu,
- approval memenuhi four-eyes rule bila validasi dilakukan di luar engine,
- data snapshot saat keputusan sama dengan data sekarang,
- dokumen lampiran tidak berubah setelah keputusan,
- external system benar-benar menerima command,
- email benar-benar terkirim dan diterima,
- user tidak berbagi akun,
- alasan hukum/administratif keputusan cukup,
- regulatory retention rule terpenuhi.

Untuk itu perlu domain audit model.

---

## 10. Regulatory Traceability Model

Untuk sistem enforcement/case management, traceability tidak cukup berupa process diagram dan task log.

Model defensible biasanya punya layer berikut:

```text
Case
 ├── Process Instance Link
 ├── Business State Transitions
 ├── Human Decisions
 ├── Evidence/Documents
 ├── Assignments and Work Queue Events
 ├── SLA/Escalation Events
 ├── Integration Commands/Events
 ├── Security/AuthZ Decisions
 └── Camunda Technical History
```

### 10.1 Case State Transition

Domain table:

```sql
CASE_STATE_AUDIT
----------------
ID
CASE_ID
FROM_STATE
TO_STATE
ACTION
ACTOR_USER_ID
ACTOR_ROLE
ACTOR_ORG_UNIT
REASON_CODE
REASON_TEXT
DECISION_ID
PROCESS_INSTANCE_ID
TASK_ID
CORRELATION_ID
CREATED_AT
```

### 10.2 Human Decision

```sql
CASE_DECISION
-------------
ID
CASE_ID
DECISION_TYPE
DECISION_OUTCOME
DECISION_REASON_CODE
DECISION_REASON_TEXT
DECISION_PAYLOAD_JSON
DATA_SNAPSHOT_HASH
EVIDENCE_BUNDLE_ID
ACTOR_USER_ID
ACTOR_ROLE
TASK_ID
PROCESS_INSTANCE_ID
CREATED_AT
```

### 10.3 Evidence Bundle

```sql
EVIDENCE_BUNDLE
---------------
ID
CASE_ID
VERSION
HASH
STORAGE_URI
CREATED_BY
CREATED_AT
IMMUTABILITY_STATUS
```

### 10.4 Link ke Camunda

Simpan foreign/reference id:

- `processInstanceId`,
- `processDefinitionId`,
- `businessKey`,
- `taskId`,
- `activityInstanceId` bila relevan,
- `executionId` hanya untuk diagnostic; jangan jadikan business contract utama.

Business key sebaiknya stabil:

```text
businessKey = CASE-2026-000123
```

Bukan random UUID yang tidak bermakna bagi operator.

---

## 11. Timeline Reconstruction

Target forensic umum:

> “Tolong tunjukkan semua yang terjadi pada case X dari awal sampai selesai.”

Naive approach:

```java
historyService.createHistoricActivityInstanceQuery()
  .processInstanceId(pid)
  .orderByHistoricActivityInstanceStartTime()
  .asc()
  .list();
```

Masalahnya:

- activity timeline teknis bisa terlalu noisy,
- gateway/internal activity mungkin tidak relevan untuk auditor,
- call activity/subprocess bisa tersebar,
- user decisions ada di domain table,
- external events ada di integration audit,
- documents ada di evidence store,
- security access ada di security audit.

Approach lebih baik:

```text
Timeline projection = merge sorted events from:
  - ACT_HI_PROCINST
  - ACT_HI_ACTINST selected activity types
  - ACT_HI_TASKINST
  - ACT_HI_OP_LOG
  - ACT_HI_INCIDENT
  - domain case audit
  - decision audit
  - integration audit
  - evidence audit
  - security audit
```

Buat explicit event type:

```text
CASE_CREATED
PROCESS_STARTED
TASK_ASSIGNED
TASK_CLAIMED
DECISION_SUBMITTED
STATE_CHANGED
DOCUMENT_ATTACHED
MESSAGE_RECEIVED
EXTERNAL_SYSTEM_NOTIFIED
SLA_BREACHED
INCIDENT_CREATED
INCIDENT_RESOLVED
PROCESS_COMPLETED
```

Auditor tidak butuh melihat semua gateway internal. Mereka butuh timeline yang dapat dipertahankan.

---

## 12. History Query Design

### 12.1 Selalu Pakai Pagination

Jangan:

```java
historyService.createHistoricActivityInstanceQuery()
    .processInstanceId(pid)
    .list(); // unsafe for large instances
```

Lebih aman:

```java
int pageSize = 200;
int first = 0;

while (true) {
    List<HistoricActivityInstance> page = historyService
        .createHistoricActivityInstanceQuery()
        .processInstanceId(pid)
        .orderByHistoricActivityInstanceStartTime()
        .asc()
        .listPage(first, pageSize);

    if (page.isEmpty()) {
        break;
    }

    handle(page);
    first += page.size();
}
```

### 12.2 Hindari Query by Large Variable

Query variable historis berguna, tetapi jangan jadikan search engine.

Buruk:

```java
historyService.createHistoricProcessInstanceQuery()
    .variableValueEquals("fullApplicationJson", hugeJson)
    .list();
```

Lebih baik:

- simpan searchable facts sebagai primitive variable kecil;
- simpan business search index di domain DB/OpenSearch;
- simpan payload besar sebagai document/evidence/snapshot dengan hash/reference.

### 12.3 Pisahkan Operational Query dan Reporting Query

Camunda DB adalah operational DB engine. Heavy analytics sebaiknya diproyeksikan ke:

- reporting database,
- data warehouse,
- event stream,
- materialized read model,
- OpenSearch untuk search UI,
- object storage untuk archive.

Jangan membuat dashboard yang tiap refresh melakukan join berat ke `ACT_HI_DETAIL` dan `ACT_HI_VARINST` di production engine DB.

---

## 13. Data Retention dan History Cleanup

History cleanup adalah mekanisme untuk menghapus historic data setelah masa simpan habis.

Konsep utama:

```text
historyTimeToLive + base time = removal time
```

Camunda memiliki dua strategi cleanup:

1. **Removal-time-based**
2. **End-time-based**

### 13.1 History Time To Live

TTL bisa didefinisikan pada process definition:

```xml
<process id="enforcementCase"
         name="Enforcement Case"
         isExecutable="true"
         camunda:historyTimeToLive="P3650D">
  ...
</process>
```

Atau numeric days:

```xml
<process id="holidayRequest"
         isExecutable="true"
         camunda:historyTimeToLive="30">
  ...
</process>
```

TTL juga bisa diupdate via API:

```java
repositoryService.updateProcessDefinitionHistoryTimeToLive(
    processDefinitionId,
    3650
);
```

Catatan penting:

- default TTL bisa dikonfigurasi engine-wide untuk definition baru;
- mengubah default TTL tidak mengubah definition lama;
- mengubah TTL definition tidak selalu mengubah removal time historis yang sudah tertulis, tergantung strategi;
- TTL `null` bisa bermasalah bila engine mengharuskan TTL pada deployment.

### 13.2 Removal-Time-Based Cleanup

Strategi default/recommended di banyak skenario modern.

Cara berpikir:

```text
At history event creation/completion:
  removalTime = baseTime + TTL

Cleanup later:
  DELETE WHERE REMOVAL_TIME_ < now
```

Kelebihan:

- efisien,
- deletion bisa berdasarkan kolom removal time,
- hierarchy process/call activity bisa dibersihkan konsisten,
- cocok untuk partitioning by removal time.

Kekurangan:

- hanya data yang punya removal time yang bisa dibersihkan;
- data dari versi lama sebelum removal time support bisa butuh batch operation/manual strategy;
- perubahan TTL tidak otomatis memperbarui removal time lama;
- case instance history memiliki limitasi cleanup tertentu.

### 13.3 End-Time-Based Cleanup

Cara berpikir:

```text
Cleanup calculates:
  endTime + TTL < now
```

Kelebihan:

- perubahan TTL bisa mempengaruhi data lama;
- bisa menangani data dari versi lama.

Kekurangan:

- lebih mahal karena end time tidak ada di semua table;
- perlu fetch cleanable instances lalu delete related rows;
- hierarchy bisa terhapus tidak atomik;
- lebih berat untuk DB besar.

### 13.4 Cleanup Window

Cleanup dijalankan oleh job executor dan bersaing dengan job lain. Maka sebaiknya cleanup window diset saat load rendah.

Contoh konfigurasi:

```xml
<property name="historyCleanupBatchWindowStartTime">20:00</property>
<property name="historyCleanupBatchWindowEndTime">06:00</property>
```

Tanpa cleanup window, automated cleanup tidak berjalan.

### 13.5 Batch Size

Default/maksimum batch size adalah 500 menurut dokumentasi Camunda 7.24. Jika terjadi transaction timeout, kurangi.

```xml
<property name="historyCleanupBatchSize">100</property>
```

### 13.6 Degree of Parallelism

```xml
<property name="historyCleanupDegreeOfParallelism">4</property>
```

Nilai tinggi bisa mempercepat cleanup, tetapi akan memakai lebih banyak job executor thread dan DB connection.

Rule praktis:

- mulai dari 1,
- monitor DB CPU/I/O/locks,
- naikkan bertahap,
- jangan jalankan cleanup agresif bersamaan dengan batch business/job spike.

### 13.7 Clustered Cleanup

Dalam cluster, tidak semua node harus ikut cleanup. Node tertentu bisa dinonaktifkan:

```xml
<property name="historyCleanupEnabled">false</property>
```

Tetapi konfigurasi TTL/removal strategy tetap harus konsisten di semua node.

---

## 14. Retention Policy Engineering

Retention bukan hanya konfigurasi Camunda. Retention adalah policy lintas data.

Contoh matrix:

| Data | Lokasi | Retention | Cleanup owner |
|---|---|---:|---|
| Process technical history | `ACT_HI_*` | 7 tahun | Camunda cleanup |
| Case decision audit | domain DB | 10 tahun | archival job/domain policy |
| Evidence documents | object storage | 10 tahun/lebih | document lifecycle policy |
| Security logs | SIEM/log store | 1–7 tahun | security platform |
| Integration logs | integration DB/log | 1–3 tahun | integration service |
| Debug application logs | log platform | 30–90 hari | logging platform |

Pertanyaan penting:

- Apakah retention dihitung dari case closure atau data creation?
- Apakah appeal/reopen memperpanjang retention?
- Apakah legal hold bisa menghentikan deletion?
- Apakah deletion harus hard delete atau archive?
- Apakah PII harus masked/anonymized sebelum retention habis?
- Apakah audit evidence boleh dihapus jika process history dihapus?
- Apakah retention rule berbeda per agency/module/case type?

Camunda TTL hanya menjawab sebagian: kapan historic process/decision/batch data cleanable.

---

## 15. Legal Hold dan Deletion Freeze

Regulatory system sering perlu legal hold:

```text
Case under investigation / appeal / litigation
  -> jangan hapus history/evidence walau TTL expired
```

Camunda history cleanup out-of-the-box berbasis TTL/removal time. Jika legal hold diperlukan, desain harus jelas.

Pilihan:

### Option A — TTL Panjang Untuk Semua

Sederhana tetapi boros.

```text
All enforcement cases TTL = 10 years
```

Cocok bila volume moderat dan policy sederhana.

### Option B — Domain Archive Sebelum Cleanup

Sebelum Camunda cleanup, export snapshot ke immutable archive.

```text
ACT_HI_* -> archive projection -> verify -> cleanup
```

Perlu:

- export job,
- hash/checksum,
- replay/read validation,
- audit of archive operation.

### Option C — Process Definition Per Retention Class

Misal:

- `simple_case_process` TTL 2 tahun,
- `enforcement_case_process` TTL 10 tahun.

Mudah, tetapi process model bisa proliferate.

### Option D — Custom Cleanup/External Partitioning

Gunakan removal time untuk partitioning, tetapi domain legal hold menentukan partition drop/deletion.

Ini paling advanced, cocok untuk volume besar, tetapi perlu DBA kuat.

---

## 16. History and Privacy/Security

History sering menjadi tempat bocornya data sensitif karena engineer lupa bahwa variable akan dihistorize.

Risiko:

- PII tersimpan di `ACT_HI_VARINST`,
- full JSON application payload tersimpan di history,
- document content/file variable masuk ke byte array,
- failed job exception detail menyimpan remote response/error sensitif,
- user operation log mengandung old/new values,
- historic decision input/output mengandung risk/eligibility data.

Policy aman:

```text
1. Jangan simpan secret/token/password sebagai variable.
2. Jangan simpan full PII payload jika cukup reference id.
3. Gunakan redacted snapshot untuk process variable.
4. Simpan sensitive evidence di secured document store.
5. Pastikan access control untuk history query/UI.
6. Batasi REST history endpoint.
7. Masking di reporting layer.
8. Cleanup/retention diuji, bukan diasumsikan.
```

Contoh buruk:

```java
execution.setVariable("singpassAccessToken", accessToken);
execution.setVariable("fullCustomerProfile", profileJson);
```

Lebih baik:

```java
execution.setVariable("applicantId", applicantId);
execution.setVariable("profileSnapshotId", snapshotId);
execution.setVariable("riskBand", riskBand);
execution.setVariable("profileSnapshotHash", snapshotHash);
```

---

## 17. History vs Event Sourcing

Camunda history sering disalahartikan sebagai event store.

Perbedaan:

| Aspek | Camunda History | Event Sourcing |
|---|---|---|
| Tujuan | Audit/query process execution | Sumber kebenaran state bisnis |
| Format | Engine-defined entities | Domain-defined events |
| Stability | Bisa berubah antar versi/schema | Dikontrak oleh domain |
| Replay | Tidak dirancang sebagai replay source utama | Dirancang untuk replay |
| Semantik | Technical process lifecycle | Business fact |
| Mutation cleanup | TTL/cleanup umum | Retention/domain policy khusus |

Jangan melakukan:

```text
Business state = reconstruct dari ACT_HI_ACTINST + ACT_HI_VARINST
```

Lebih kuat:

```text
Business state = domain aggregate/state table
Business audit = domain events/audit rows
Workflow history = Camunda ACT_HI_*
```

Camunda mengorkestrasi; domain tetap pemilik business truth.

---

## 18. Audit Event Design Pattern

Saat user menyelesaikan task, jangan hanya:

```java
taskService.complete(taskId, variables);
```

Pattern lebih defensible:

```text
API receives decision request
  -> authenticate user
  -> authorize against domain state
  -> load task and verify task belongs to case
  -> validate task/action allowed
  -> create domain decision audit row
  -> create evidence snapshot/hash
  -> complete Camunda task with small variables
  -> transaction commits
```

Dalam Spring transaction:

```java
@Transactional
public void submitReviewDecision(SubmitDecisionCommand command) {
    UserContext user = userContext.current();

    CaseRecord caseRecord = caseRepository.getForUpdate(command.caseId());
    Task task = taskService.createTaskQuery()
        .taskId(command.taskId())
        .processInstanceBusinessKey(caseRecord.caseNo())
        .singleResult();

    if (task == null) {
        throw new InvalidTaskException("Task not found for case");
    }

    authorizationPolicy.checkCanSubmitReview(user, caseRecord, task);

    DecisionRecord decision = decisionRepository.save(DecisionRecord.create(
        caseRecord.id(),
        command.outcome(),
        command.reasonCode(),
        command.reasonText(),
        user.userId(),
        user.role(),
        task.getId(),
        task.getProcessInstanceId(),
        command.evidenceBundleId()
    ));

    Map<String, Object> variables = Map.of(
        "reviewOutcome", command.outcome().name(),
        "reviewDecisionId", decision.id().toString()
    );

    taskService.complete(task.getId(), variables);
}
```

Catatan:

- transaksi Spring + Camunda harus benar-benar sama transaction manager bila ingin atomic;
- bila task completion lanjut ke remote side effect synchronous, tetap ada risiko rollback/side-effect; gunakan async/outbox;
- `DecisionRecord` menjadi business audit, Camunda history menjadi technical trace.

---

## 19. Reconstructing “Who Did What”

Untuk menjawab siapa melakukan apa, gabungkan:

1. `ACT_HI_TASKINST` — task lifecycle;
2. `ACT_HI_OP_LOG` — operation details, jika `FULL` dan user context ada;
3. domain audit — action/outcome/reason;
4. auth/security log — authentication/session;
5. application request log — request id/correlation id.

Contoh issue:

```text
ACT_HI_TASKINST says task assignee = alice
ACT_HI_OP_LOG says task completed by bob
Domain audit says decision actor = bob acting as supervisor
Security log says bob logged in via SSO
```

Ini bisa valid bila task reassignment/delegation terjadi. Jangan menyimpulkan hanya dari satu table.

---

## 20. User Operation Log Annotation

Camunda user operation log mendukung annotation untuk memberi konteks operasi tertentu.

Contoh penggunaan:

```java
String operationId = historyService.createUserOperationLogQuery()
    .processInstanceId(processInstanceId)
    .orderByTimestamp()
    .desc()
    .listPage(0, 1)
    .get(0)
    .getOperationId();

historyService.setAnnotationForOperationLogById(
    operationId,
    "Restarted due to external system outage INC-2026-0142"
);
```

Untuk operasi manual penting seperti process modification/restart, annotation membantu menjelaskan **why**, bukan hanya **what**.

Policy:

- wajibkan annotation untuk modification/restart/delete/suspend mass operation;
- simpan incident ticket/reference;
- catat approver/operator;
- jangan izinkan operator melakukan silent modification di production.

---

## 21. History Cleanup Failure Modes

### 21.1 Cleanup Tidak Jalan

Kemungkinan:

- cleanup window belum dikonfigurasi;
- job executor mati;
- no cleanable data karena TTL tidak ada;
- removal time null;
- history cleanup job retries habis;
- node tidak ikut cleanup (`historyCleanupEnabled=false`);
- clock/timezone/config berbeda antar node;
- cleanup job kalah resources dari job lain.

Diagnostic:

```java
List<Job> cleanupJobs = historyService.findHistoryCleanupJobs();
```

Cek juga:

```sql
select count(*)
from ACT_RU_JOB
where TYPE_ = 'history-cleanup';
```

Nama/type detail bisa berbeda antar versi/internal, jadi pakai API dulu.

### 21.2 TTL Diubah Tapi Data Lama Tidak Terhapus

Dengan removal-time-based strategy, perubahan TTL definition tidak otomatis memperbarui removal time data lama. Perlu batch operation untuk set removal time atau strategi cleanup yang sesuai.

### 21.3 Cleanup Lambat

Kemungkinan:

- batch size terlalu kecil,
- degree parallelism terlalu rendah,
- index kurang,
- DB I/O bottleneck,
- banyak `ACT_HI_DETAIL`/byte array,
- cleanup window terlalu pendek,
- long transaction timeout,
- locks/maintenance conflict.

Mitigasi:

- ukur cleanable count;
- lakukan cleanup bertahap;
- kurangi batch size bila timeout;
- tambah window;
- pertimbangkan removal-time strategy dan partitioning;
- export/archive dulu bila perlu.

### 21.4 Cleanup Mengganggu Production Load

Karena cleanup memakai job executor dan DB connection, ia bisa bersaing dengan timer/async jobs.

Mitigasi:

- jalankan window malam/weekend;
- limit degree parallelism;
- pisahkan node cleanup bila arsitektur memungkinkan;
- monitor DB CPU, IOPS, locks, replication lag;
- jangan jalankan batch business besar bersamaan.

---

## 22. Storage Growth Model

History growth kira-kira dipengaruhi oleh:

```text
history size = process count
             × average activities per process
             × average tasks per process
             × variable count
             × variable update frequency
             × payload size
             × history level factor
             × job/external task retry factor
```

Sumber ledakan:

1. `FULL` + frequent variable updates;
2. JSON besar sebagai variable;
3. file/bytes variables;
4. job retry storm;
5. external task failure storm;
6. high-volume timers;
7. no cleanup window;
8. TTL terlalu panjang untuk semua process;
9. reporting query membuat index/table bloat;
10. process instances yang never end.

Contoh kapasitas:

```text
10,000 cases/day
× 30 activities/case
= 300,000 activity history rows/day

10,000 cases/day
× 20 variable updates/case
= 200,000 variable/detail rows/day

Jika payload variable besar,
ACT_GE_BYTEARRAY dan ACT_HI_DETAIL bisa tumbuh cepat.
```

Jangan menunggu storage critical baru memikirkan cleanup.

---

## 23. Indexing dan Reporting

Camunda schema memiliki index bawaan, tetapi custom reporting bisa butuh strategi tambahan.

Namun hati-hati:

- custom index mempercepat query tertentu,
- tetapi memperlambat insert/update/delete,
- bisa membuat upgrade/maintenance lebih rumit,
- harus diuji dengan workload Camunda.

Lebih baik:

```text
Operational Camunda DB
  -> minimal necessary query
  -> cleanup

Reporting Projection DB
  -> denormalized timeline/search
  -> business dashboard
  -> heavy filters
```

Jika tetap query Camunda history:

- filter by `PROC_INST_ID_`, `BUSINESS_KEY_`, `PROC_DEF_KEY_`, date range;
- selalu paginate;
- hindari leading wildcard;
- hindari variable LIKE pada payload besar;
- batasi historical detail query.

---

## 24. History in Multi-Tenant Systems

Jika menggunakan tenant id:

- process definitions bisa tenant-aware,
- process instances punya tenant context,
- history juga harus difilter tenant,
- reporting harus enforce tenant isolation,
- cleanup policy bisa berbeda per tenant/agency.

Risiko:

```text
Admin/reporting endpoint accidentally queries all tenants
```

Mitigasi:

- tenant filter mandatory di API;
- row-level security di reporting DB bila perlu;
- avoid exposing raw HistoryService result to frontend;
- audit admin cross-tenant access;
- test tenant leakage.

---

## 25. Cockpit, REST, dan History Access

Camunda Cockpit berguna untuk operational/debugging, tetapi aksesnya harus dikontrol.

Risiko:

- operator bisa melihat variables sensitif,
- incident/job failure detail bisa berisi response/error sensitif,
- historic variable bisa expose PII,
- process modification/retry operation bisa berdampak besar.

Best practice:

```text
Cockpit access:
  - restricted to trained operators
  - production access audited
  - least privilege
  - no shared accounts
  - operation annotation for sensitive actions

Application users:
  - never access raw Cockpit
  - use business UI/API
  - history projected and masked
```

REST history endpoints juga harus diamankan. Jangan expose Camunda REST langsung ke browser/user tanpa API gateway/domain authorization.

---

## 26. Incident Forensic Dengan History

Misal proses stuck karena async service task gagal.

Langkah:

1. Cari process instance by business key.
2. Query runtime execution/task/job/incident.
3. Query historic activity path.
4. Query historic job log untuk failure sequence.
5. Query historic variable latest/snapshot.
6. Query domain audit untuk decision terakhir.
7. Query integration audit untuk remote call.
8. Query logs dengan correlation id.

Contoh Java:

```java
HistoricProcessInstance hpi = historyService
    .createHistoricProcessInstanceQuery()
    .processInstanceBusinessKey("CASE-2026-000123")
    .singleResult();

List<HistoricJobLog> jobLogs = historyService
    .createHistoricJobLogQuery()
    .processInstanceId(hpi.getId())
    .orderByTimestamp()
    .asc()
    .list();

List<HistoricIncident> incidents = historyService
    .createHistoricIncidentQuery()
    .processInstanceId(hpi.getId())
    .list();
```

Forensic conclusion harus jelas memisahkan:

```text
Observed facts:
  - job failed 3 times
  - incident created at X
  - external API returned timeout in integration log
  - no business decision was committed after Y

Inference:
  - likely remote service outage caused async task incident

Action:
  - fix remote dependency
  - retry job
  - annotate operation log with incident ticket
```

---

## 27. Reopen, Restart, Modification, dan Audit

Production workflow sering membutuhkan:

- reopen case,
- restart process instance,
- modify activity state,
- set job retries,
- migrate instance,
- delete mistaken instance.

Semua ini harus diaudit.

Policy minimum:

```text
For every manual intervention:
  - operator id
  - reason
  - ticket/reference
  - approval if high risk
  - before/after process state snapshot
  - business impact assessment
  - Camunda operation log annotation
  - domain audit row if business-visible
```

Jangan hanya mengandalkan “Cockpit user did something”. Untuk regulatory system, operator intervention bisa mempengaruhi outcome case.

---

## 28. Archival Strategy

Untuk volume besar, cleanup saja tidak cukup. Anda mungkin perlu archive.

Pattern:

```text
1. Identify finished instances eligible for archival.
2. Extract process timeline, task history, variable summary, incidents, job logs.
3. Extract domain audit/evidence references.
4. Write immutable archive artifact.
5. Compute hash/checksum.
6. Store archive metadata in domain archive table.
7. Verify retrieval.
8. Allow Camunda history cleanup later.
```

Archive artifact bisa berupa:

- JSON timeline,
- Parquet dataset,
- PDF audit report,
- object storage bundle,
- WORM/compliance storage.

Jangan archive hanya raw SQL dump tanpa semantic index. Auditor butuh retrieval by case no/business key.

---

## 29. Custom History Handler: Kapan Perlu?

Custom history handler justified bila:

- perlu stream audit ke immutable ledger/log;
- perlu split operational DB dan audit DB;
- perlu filter/enrich events secara platform-wide;
- perlu near-real-time reporting tanpa polling history tables;
- perlu comply dengan audit architecture enterprise.

Tidak justified bila:

- hanya ingin report sederhana;
- belum paham default history;
- cleanup belum dikonfigurasi;
- variable payload masih berantakan;
- tidak punya test/upgrade budget.

Design guardrails:

```text
Custom history handler must be:
  - fast
  - transactional semantics understood
  - failure behavior documented
  - idempotent if exporting externally
  - version-tested
  - observable
  - protected from leaking PII
```

Jika handler melakukan remote call langsung di transaction engine, itu red flag besar. Lebih aman publish ke outbox/local table lalu exporter terpisah.

---

## 30. Java 8–25 Considerations

Camunda 7 estate bisa berada di Java 8 legacy sampai Java 17/21 modern tergantung versi Camunda/container/Spring.

Untuk history/audit code:

### Java 8 Baseline

- hindari API modern bila library harus legacy;
- gunakan immutable DTO manual;
- hati-hati date/time conversion dari `java.util.Date` ke `java.time`;
- batasi stream over huge lists.

### Java 11/17

- gunakan `java.time` kuat di domain layer;
- gunakan records hanya jika runtime/library mendukung dan bukan public legacy API;
- gunakan structured logging dan JSON serializers modern;
- gunakan text blocks untuk SQL jika Java 15+.

### Java 21/25 Planning

- virtual threads tidak otomatis menyelesaikan DB-bound history query;
- cleanup tetap dibatasi DB/job executor;
- use modern Java for tooling/exporter, tetapi engine compatibility tetap mengacu Camunda version;
- jangan membuat process variable serialized Java object memakai class modern yang tidak kompatibel dengan engine runtime lama.

Principle:

```text
History data must outlive Java class versions.
```

Maka gunakan schema-stable JSON/primitive/reference, bukan serialized object.

---

## 31. Production Checklist

### 31.1 History Level

- [ ] History level dipilih sadar, bukan default asal.
- [ ] Perbedaan `audit` vs `full` dipahami.
- [ ] `FULL` hanya dipakai bila storage/security/cleanup siap.
- [ ] Semua cluster node konsisten.
- [ ] Cockpit/reporting expectation sesuai level.

### 31.2 Variable and Sensitive Data

- [ ] Tidak ada secret/token/password di variable.
- [ ] Payload besar tidak disimpan sebagai variable biasa.
- [ ] PII diminimalkan/masked.
- [ ] Serialized Java object dihindari.
- [ ] Variable naming policy tersedia.

### 31.3 Audit Model

- [ ] Domain decision audit ada.
- [ ] Evidence/document versioning ada.
- [ ] Business state transition audit ada.
- [ ] Integration audit ada.
- [ ] Security audit terhubung dengan user/correlation id.
- [ ] Camunda history dipakai sebagai technical trace, bukan satu-satunya audit.

### 31.4 Cleanup

- [ ] `historyTimeToLive` diset untuk definitions.
- [ ] Cleanup strategy dipilih.
- [ ] Cleanup window dikonfigurasi.
- [ ] Batch size diuji.
- [ ] Degree of parallelism diuji.
- [ ] Cleanup job dimonitor.
- [ ] Cleanup failure alert tersedia.
- [ ] Retention policy lintas data terdokumentasi.

### 31.5 Reporting

- [ ] Heavy reporting tidak langsung membebani operational Camunda DB.
- [ ] Query history pakai pagination.
- [ ] Tenant/security filtering enforce.
- [ ] UI tidak expose raw sensitive history.
- [ ] Timeline projection dibuat untuk auditor/user.

### 31.6 Operations

- [ ] Manual operation wajib annotation/ticket.
- [ ] Process modification/restart policy tersedia.
- [ ] Operator access least privilege.
- [ ] Incident forensic playbook tersedia.
- [ ] Archive/retrieval diuji.

---

## 32. Common Anti-Patterns

### Anti-Pattern 1 — Camunda History as Legal Audit Trail Only

Masalah:

- tidak capture business reason/evidence cukup;
- sensitive data campur;
- sulit menjawab “why”.

Solusi:

- tambahkan domain audit dan evidence model.

### Anti-Pattern 2 — `FULL` History Tanpa Cleanup

Masalah:

- DB membengkak;
- query lambat;
- backup/restore mahal;
- storage incident.

Solusi:

- retention, TTL, cleanup window, archive.

### Anti-Pattern 3 — Full Application JSON as Variable

Masalah:

- storage besar;
- history detail besar;
- security risk;
- migration sulit.

Solusi:

- reference id + small routing facts + snapshot hash.

### Anti-Pattern 4 — Reporting Directly from `ACT_HI_DETAIL`

Masalah:

- expensive query;
- noisy data;
- schema coupling.

Solusi:

- reporting projection.

### Anti-Pattern 5 — Manual SQL Delete From History Without Policy

Masalah:

- partial data removal;
- audit gap;
- compliance risk;
- unexpected tool behavior.

Solusi:

- official cleanup, archive, tested DBA procedure.

### Anti-Pattern 6 — No User Context for Service Operations

Masalah:

- user operation log kosong/technical;
- sulit audit siapa melakukan apa.

Solusi:

- propagate authenticated user context to business audit;
- set authenticated user id where appropriate;
- log service actor separately.

---

## 33. Worked Example: Enforcement Case Audit

### Scenario

Case `CASE-2026-000123`:

1. Applicant submits report.
2. Officer reviews.
3. Supervisor approves enforcement action.
4. External notice system sends notice.
5. Case waits for appeal window.
6. Case closes.

### BPMN Variables

Good variables:

```text
caseId = 123
caseNo = CASE-2026-000123
reviewOutcome = PROCEED
reviewDecisionId = 9182
approvalOutcome = APPROVED
approvalDecisionId = 9189
noticeCommandId = CMD-2026-88421
appealDeadline = 2026-09-30T16:00:00+08:00
```

Bad variables:

```text
fullApplicantProfileJson
allEvidenceBase64
accessToken
completeCaseAggregateSerializedJavaObject
```

### Business Audit

```text
CASE_STATE_AUDIT:
  NEW -> UNDER_REVIEW
  UNDER_REVIEW -> PENDING_SUPERVISOR_APPROVAL
  PENDING_SUPERVISOR_APPROVAL -> APPROVED_FOR_ENFORCEMENT
  APPROVED_FOR_ENFORCEMENT -> NOTICE_SENT
  NOTICE_SENT -> CLOSED
```

### Camunda History

Use for:

- task execution timeline,
- process path,
- job/external task failures,
- incident tracking,
- operator modifications.

### Timeline UI

```text
2026-07-01 09:00  Case submitted
2026-07-01 09:01  Process started
2026-07-02 10:15  Review task claimed by Officer A
2026-07-02 11:20  Review decision: PROCEED
2026-07-02 14:10  Supervisor approval task assigned
2026-07-03 09:30  Supervisor decision: APPROVED
2026-07-03 09:31  Notice command sent
2026-07-03 09:35  Notice delivery confirmed
2026-09-30 16:00  Appeal window expired
2026-09-30 16:02  Case closed
```

Underneath, each timeline item links to:

- Camunda historic task/activity/process id,
- domain decision id,
- evidence bundle id,
- integration event id,
- security/request correlation id.

---

## 34. Diagnostic SQL Examples

Use read-only, version-aware, and preferably in non-production replica where possible.

### 34.1 Count History Rows

```sql
select 'ACT_HI_PROCINST' as table_name, count(*) as cnt from ACT_HI_PROCINST
union all
select 'ACT_HI_ACTINST', count(*) from ACT_HI_ACTINST
union all
select 'ACT_HI_TASKINST', count(*) from ACT_HI_TASKINST
union all
select 'ACT_HI_VARINST', count(*) from ACT_HI_VARINST
union all
select 'ACT_HI_DETAIL', count(*) from ACT_HI_DETAIL
union all
select 'ACT_HI_JOB_LOG', count(*) from ACT_HI_JOB_LOG
union all
select 'ACT_HI_OP_LOG', count(*) from ACT_HI_OP_LOG;
```

### 34.2 Finished Process by Definition

```sql
select PROC_DEF_KEY_, count(*) as cnt
from ACT_HI_PROCINST
where END_TIME_ is not null
group by PROC_DEF_KEY_
order by cnt desc;
```

### 34.3 Candidate for Cleanup by Removal Time

```sql
select PROC_DEF_KEY_, count(*) as cnt
from ACT_HI_PROCINST
where REMOVAL_TIME_ is not null
  and REMOVAL_TIME_ < current_timestamp
group by PROC_DEF_KEY_
order by cnt desc;
```

### 34.4 Null Removal Time

```sql
select PROC_DEF_KEY_, count(*) as cnt
from ACT_HI_PROCINST
where END_TIME_ is not null
  and REMOVAL_TIME_ is null
group by PROC_DEF_KEY_
order by cnt desc;
```

If many finished instances have null removal time, check TTL, strategy, version history, and whether batch operation is needed.

### 34.5 Largest Serialized Payload Candidates

Vendor-specific because byte length differs.

PostgreSQL-like idea:

```sql
select NAME_, TYPE_, count(*) as cnt
from ACT_HI_VARINST
group by NAME_, TYPE_
order by cnt desc;
```

Then inspect associated byte arrays carefully. Do not dump sensitive values into logs.

---

## 35. Design Heuristics

### 35.1 Keep Camunda Variables Small

If a variable is:

- large,
- sensitive,
- frequently updated,
- needed for long-term audit,
- needed by reports,
- likely to evolve schema,

then it probably belongs outside Camunda as domain data, with Camunda storing reference/key/hash.

### 35.2 Treat History as Technical Audit

Camunda history explains process execution. Domain audit explains business meaning.

### 35.3 Make Retention Explicit From Day One

Every process definition should answer:

- how long should history live?
- what is the retention class?
- what is archived before cleanup?
- who can access history?
- what data is masked?

### 35.4 Design For Forensics Before Incident

Do not wait for an incident to discover that:

- no correlation id exists,
- user id was not propagated,
- variables were overwritten,
- evidence was mutable,
- cleanup deleted necessary context,
- history level was too low.

### 35.5 Avoid One Giant Audit Table With No Semantics

A good audit system has typed events and stable schema. A giant text log is hard to defend.

---

## 36. Part Summary

Camunda 7 history is powerful, but it must be treated carefully.

Key conclusions:

1. History is an event/projection layer, not runtime state.
2. Runtime `ACT_RU_*` and history `ACT_HI_*` serve different purposes.
3. History level controls event volume and audit depth.
4. `FULL` gives more forensic detail but increases storage/security/cleanup risk.
5. Camunda history is not automatically complete legal/regulatory audit.
6. Domain audit, evidence store, security audit, and integration audit are still required.
7. History cleanup is mandatory for serious production systems.
8. TTL, removal time, cleanup window, batch size, and parallelism must be deliberately configured.
9. Reporting should usually use projection/read model, not heavy direct queries on operational history tables.
10. Retention is a cross-system policy, not just Camunda config.

A senior engineer does not ask only:

> “Apakah prosesnya jalan?”

A senior engineer asks:

> “Bisakah kita membuktikan apa yang terjadi, kenapa terjadi, siapa yang melakukan, berdasarkan data apa, apakah recoverable, dan apakah data itu disimpan/dihapus sesuai aturan?”

That is the real purpose of history, auditability, traceability, and retention engineering.

---

## 37. Referensi

- Camunda 7.24 Documentation — History: https://docs.camunda.org/manual/7.24/user-guide/process-engine/history/
- Camunda 7.24 Documentation — History Configuration: https://docs.camunda.org/manual/7.24/user-guide/process-engine/history/history-configuration/
- Camunda 7.24 Documentation — User Operation Log: https://docs.camunda.org/manual/7.24/user-guide/process-engine/history/user-operation-log/
- Camunda 7.24 Documentation — History Cleanup: https://docs.camunda.org/manual/7.24/user-guide/process-engine/history/history-cleanup/
- Camunda 7.24 Documentation — Database Schema: https://docs.camunda.org/manual/7.24/user-guide/process-engine/database/database-schema/


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-015.md">⬅️ Part 015 — Human Task Engineering: Task Lifecycle, Assignment, Candidate Groups, Authorization, and Work Queue Design</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-017.md">Part 017 — Incidents, Error Taxonomy, BPMN Error, Escalation, Compensation, dan Recovery Semantics ➡️</a>
</div>
