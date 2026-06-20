# learn-java-camunda-7-bpm-platform-engineering-part-006.md

# Part 006 — Database Schema Mastery: ACT_RU, ACT_HI, ACT_RE, ACT_GE, ACT_ID

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Level: Advanced / Principal Engineer  
> Fokus: memahami database schema Camunda 7 sebagai model runtime, audit, deployment, operasi, dan diagnostic — bukan sebagai API publik yang bebas dimodifikasi.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

- engine architecture,
- command pattern,
- `CommandContext`,
- wait state,
- transaction boundary,
- async continuation,
- job lifecycle,
- job executor acquisition,
- retry dan incident.

Sekarang kita masuk ke bagian yang biasanya membedakan engineer biasa dan engineer yang benar-benar bisa mengoperasikan Camunda 7 di production: **database schema mastery**.

Camunda 7 bukan engine yang menyimpan state long-running process di memory. Ia menyimpan state proses di database relational. Karena itu, ketika sebuah process instance sedang menunggu user task, message, timer, external task, atau async continuation, state pentingnya hidup di tabel-tabel `ACT_*`.

Namun ada batas penting:

> Database schema Camunda 7 adalah implementation detail engine, bukan public API kontraktual untuk aplikasi bisnis.

Artinya:

- boleh membaca untuk troubleshooting, observability, audit, reporting tertentu, dan emergency diagnosis;
- boleh membuat query read-only dengan disiplin;
- boleh membuat index tambahan secara hati-hati jika sudah diuji;
- tidak boleh sembarang `UPDATE`, `DELETE`, atau `INSERT` langsung ke tabel engine;
- tidak boleh menganggap nama kolom dan struktur internal stabil antar minor/major upgrade;
- tidak boleh menjadikan tabel runtime Camunda sebagai domain database utama aplikasi.

Dokumentasi Camunda 7 menyatakan bahwa tabel engine dimulai dengan `ACT`, lalu bagian kedua berisi dua huruf identifikasi use case: `RE`, `RU`, `ID`, `HI`, dan `GE`. Dokumentasi yang sama juga menegaskan bahwa database bukan bagian dari public API dan schema dapat berubah pada minor maupun major version update.

Mental model part ini:

```text
Camunda Engine State
        |
        v
Relational Database Schema
        |
        +-- ACT_RE_* : deployed definitions / repository metadata
        +-- ACT_RU_* : live runtime state
        +-- ACT_HI_* : historical/audit state
        +-- ACT_GE_* : general/binary/schema/property data
        +-- ACT_ID_* : identity data
```

Kalau part 002 membahas **execution tree secara konseptual**, part ini membahas **di mana jejak execution tree itu tersimpan**.

Kalau part 003 membahas **transaction boundary**, part ini membahas **tabel apa yang berubah ketika boundary itu dicapai**.

Kalau part 005 membahas **job executor**, part ini membahas **bagaimana melihat job, lock, retry, due date, dan incident dari database**.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, Anda harus bisa:

1. Menjelaskan fungsi prefix tabel `ACT_RE`, `ACT_RU`, `ACT_HI`, `ACT_GE`, dan `ACT_ID`.
2. Membaca process instance aktif dari `ACT_RU_EXECUTION`, `ACT_RU_TASK`, `ACT_RU_JOB`, `ACT_RU_VARIABLE`, dan `ACT_RU_EVENT_SUBSCR`.
3. Membedakan runtime state dan historical state.
4. Mengetahui tabel mana yang biasanya membesar di production.
5. Mengetahui tabel mana yang hot secara write/read.
6. Membaca hubungan antara process definition, process instance, execution, task, variable, job, incident, external task, event subscription, dan byte array.
7. Mendesain query diagnostic yang aman.
8. Menghindari anti-pattern SQL langsung yang merusak engine consistency.
9. Menghubungkan schema Camunda dengan reliability, auditability, performance, dan migration.
10. Mengetahui batas antara valid observability query dan dangerous engine surgery.

---

## 2. Core Rule: Database Boleh Dibaca, Jangan Dijadikan Contract Publik

Camunda menyediakan public API:

- `RuntimeService`,
- `TaskService`,
- `RepositoryService`,
- `HistoryService`,
- `ManagementService`,
- `ExternalTaskService`,
- `IdentityService`,
- `AuthorizationService`,
- REST API,
- Cockpit,
- Tasklist,
- Admin,
- batch operations,
- process instance migration API,
- modification API,
- history cleanup.

Schema database adalah storage internal untuk API tersebut.

Mengapa ini penting?

Karena Camunda 7 engine tidak hanya menyimpan “status proses”. Ia menyimpan:

- execution tree,
- parent-child execution relation,
- scope flags,
- concurrency flags,
- sequence counters,
- task state,
- job locks,
- variable serialization metadata,
- event subscriptions,
- incidents,
- identity links,
- authorizations,
- deployment metadata,
- byte arrays,
- schema version,
- history event projection,
- metrics.

Satu mutation yang kelihatan sederhana bisa melanggar invariant internal.

Contoh berbahaya:

```sql
-- Jangan lakukan ini di production untuk "memperbaiki" task stuck
DELETE FROM ACT_RU_TASK WHERE ID_ = 'some-task-id';
```

Masalahnya:

- execution yang menunggu task masih ada;
- identity link task mungkin masih ada;
- variable local task mungkin masih ada;
- history state bisa menjadi tidak konsisten;
- process instance tidak otomatis lanjut;
- Cockpit/Tasklist bisa error;
- migration/modification bisa gagal;
- operator kehilangan forensic evidence.

Cara benar biasanya memakai:

- `taskService.complete(...)`,
- `runtimeService.createProcessInstanceModification(...)`,
- `managementService.setJobRetries(...)`,
- `runtimeService.correlateMessage(...)`,
- `runtimeService.deleteProcessInstance(...)`,
- `historyService.deleteHistoricProcessInstance(...)`,
- batch API,
- Cockpit operation,
- controlled support procedure.

Prinsipnya:

```text
Read via SQL for diagnosis.
Mutate via Engine API.
```

Exception ada, tetapi sangat sempit: emergency repair dengan backup, test reproduction, engine version knowledge, approval DBA/platform owner, dan rollback plan.

---

## 3. Big Picture: Lima Keluarga Tabel Camunda 7

Dokumentasi Camunda 7 mengelompokkan tabel utama berdasarkan prefix:

| Prefix | Makna | Karakter Data | Contoh |
|---|---|---|---|
| `ACT_RE_*` | Repository | Static/deployed definitions | `ACT_RE_DEPLOYMENT`, `ACT_RE_PROCDEF` |
| `ACT_RU_*` | Runtime | Live process state | `ACT_RU_EXECUTION`, `ACT_RU_TASK`, `ACT_RU_JOB` |
| `ACT_HI_*` | History | Historical/audit data | `ACT_HI_PROCINST`, `ACT_HI_TASKINST` |
| `ACT_GE_*` | General | Binary/properties/schema metadata | `ACT_GE_BYTEARRAY`, `ACT_GE_PROPERTY` |
| `ACT_ID_*` | Identity | Users/groups/membership | `ACT_ID_USER`, `ACT_ID_GROUP` |

Cara paling sederhana memahami schema:

```text
ACT_RE_* = what can be executed
ACT_RU_* = what is currently executing/waiting
ACT_HI_* = what happened before
ACT_GE_* = shared infrastructure storage
ACT_ID_* = who can act / identity metadata
```

Tetapi di production, Anda perlu mental model yang lebih kaya:

```text
Deployment time:
  BPMN/DMN/CMMN/forms/resources -> ACT_RE_* + ACT_GE_BYTEARRAY

Start process:
  process instance/execution tree -> ACT_RU_EXECUTION
  variables -> ACT_RU_VARIABLE + maybe ACT_GE_BYTEARRAY
  jobs/timers/async -> ACT_RU_JOB
  event wait states -> ACT_RU_EVENT_SUBSCR
  user tasks -> ACT_RU_TASK + ACT_RU_IDENTITYLINK
  history events -> ACT_HI_*

Runtime progress:
  update/delete/insert runtime rows as tokens move
  append/update history rows depending on history level

End process:
  remove runtime rows
  retain history rows until cleanup/deletion
```

---

## 4. Schema Family 1: `ACT_RE_*` — Repository Layer

`RE` stands for repository. Ini adalah keluarga tabel untuk artefak yang dideploy.

### 4.1 Mental Model Repository

Repository bukan sekadar file storage. Repository adalah catalog executable artifacts.

Di dalamnya terdapat:

- process definitions,
- decision definitions,
- case definitions,
- deployment metadata,
- resource references,
- versioning metadata,
- suspension state,
- tenant relation,
- diagram/resource name,
- deployment time.

Kalau runtime bertanya “process key `loanApproval` versi latest itu yang mana?”, jawabannya berasal dari repository tables + deployment cache.

### 4.2 Tabel Penting

Tabel yang sering ditemui:

| Tabel | Fungsi |
|---|---|
| `ACT_RE_DEPLOYMENT` | Satu deployment unit |
| `ACT_RE_PROCDEF` | Process definition BPMN yang sudah dideploy |
| `ACT_RE_DECISION_DEF` | DMN decision definition |
| `ACT_RE_DECISION_REQ_DEF` | DMN decision requirements definition |
| `ACT_RE_CASE_DEF` | CMMN case definition |

Resource binary seperti BPMN XML dan diagram biasanya tersimpan di `ACT_GE_BYTEARRAY` dan direferensikan dari repository metadata.

### 4.3 `ACT_RE_DEPLOYMENT`

Satu deployment bisa berisi banyak resource:

- `*.bpmn`,
- `*.dmn`,
- `*.cmmn`,
- forms,
- diagram,
- additional resource.

Kolom yang biasanya penting:

| Kolom | Makna Umum |
|---|---|
| `ID_` | deployment id |
| `NAME_` | deployment name |
| `DEPLOY_TIME_` | waktu deploy |
| `SOURCE_` | source deployment, tergantung integration |
| `TENANT_ID_` | tenant jika multi-tenancy dipakai |

Contoh diagnostic:

```sql
SELECT ID_, NAME_, DEPLOY_TIME_, SOURCE_, TENANT_ID_
FROM ACT_RE_DEPLOYMENT
ORDER BY DEPLOY_TIME_ DESC;
```

Kegunaan:

- mencari deployment terakhir;
- membandingkan environment DEV/UAT/PROD;
- audit deployment;
- memeriksa duplicate deployment;
- melihat apakah tenant tertentu mendapat deployment.

### 4.4 `ACT_RE_PROCDEF`

`ACT_RE_PROCDEF` menyimpan process definition.

Kolom yang sering relevan:

| Kolom | Makna Umum |
|---|---|
| `ID_` | process definition id; biasanya mengandung key, version, generated id |
| `KEY_` | BPMN process id/key |
| `VERSION_` | version number hasil deployment |
| `DEPLOYMENT_ID_` | deployment asal |
| `RESOURCE_NAME_` | BPMN resource name |
| `DGRM_RESOURCE_NAME_` | diagram resource name |
| `SUSPENSION_STATE_` | active/suspended |
| `TENANT_ID_` | tenant id |
| `VERSION_TAG_` | optional version tag |
| `HISTORY_TTL_` | history time-to-live |

Query contoh:

```sql
SELECT KEY_, VERSION_, ID_, DEPLOYMENT_ID_, RESOURCE_NAME_, SUSPENSION_STATE_, TENANT_ID_, VERSION_TAG_, HISTORY_TTL_
FROM ACT_RE_PROCDEF
WHERE KEY_ = 'enforcementCase'
ORDER BY VERSION_ DESC;
```

Mental model:

```text
Process key       = stable logical name used by business/app
Process version   = monotonically increasing deployment version per key/tenant
Process def id    = exact executable definition used by runtime
Deployment id     = bundle/source of resources
```

Kesalahan umum:

- memulai process by latest key tanpa sadar versi berubah setelah deployment;
- call activity binding latest sehingga long-running parent bisa memanggil versi child yang berubah;
- menghapus deployment yang masih dipakai instance aktif;
- menganggap `KEY_` cukup untuk forensic, padahal instance mengacu ke exact `PROC_DEF_ID_`.

### 4.5 Deployment Cache dan Repository Table

Camunda engine biasanya tidak membaca XML dari DB setiap kali token bergerak. Definitions bisa dicache di memory.

Implikasi:

- repository table adalah source of truth persistent;
- deployment cache mempercepat runtime;
- cluster node harus punya classpath/delegate yang cocok dengan definition yang dieksekusi;
- deployment-aware job executor penting di heterogeneous cluster;
- migration/rolling update harus memperhatikan definition availability.

### 4.6 Repository Anti-Pattern

Anti-pattern:

```text
Deploy setiap startup tanpa duplicate filtering
```

Dampak:

- process definition version naik terus;
- operator bingung versi mana yang dipakai;
- long-running instance terpencar di banyak version;
- Cockpit penuh duplicate version;
- migration makin sulit;
- call activity latest binding bisa unpredictable.

Pattern yang lebih baik:

- gunakan deployment discipline;
- aktifkan duplicate filtering jika sesuai;
- gunakan version tag;
- catat release artifact hash;
- align process definition version dengan application release;
- test migration plan untuk process yang long-running.

---

## 5. Schema Family 2: `ACT_RU_*` — Runtime Layer

`RU` stands for runtime. Ini adalah keluarga tabel paling penting untuk diagnosis proses aktif.

Data di `ACT_RU_*` bersifat hidup dan transient.

Dokumentasi Camunda menyatakan runtime tables menyimpan process instances, user tasks, variables, jobs, dan lain-lain selama eksekusi process instance, lalu record runtime dihapus ketika process instance selesai.

### 5.1 Runtime Layer Mental Model

Runtime tables menjawab pertanyaan:

```text
Apa yang sedang terjadi sekarang?
Apa yang sedang menunggu?
Apa yang bisa dieksekusi job executor?
Task apa yang terbuka?
Message/timer/event apa yang ditunggu?
Variable runtime apa yang masih aktif?
Incident apa yang perlu operator tangani?
```

Runtime tables bukan long-term audit store. Begitu process instance selesai normal, sebagian besar runtime rows akan hilang.

Kalau Anda hanya melihat `ACT_RU_*`, Anda tidak melihat masa lalu. Anda melihat active state.

### 5.2 Tabel Runtime Penting

| Tabel | Fungsi |
|---|---|
| `ACT_RU_EXECUTION` | execution tree/process instance runtime state |
| `ACT_RU_TASK` | open user tasks |
| `ACT_RU_VARIABLE` | runtime variables |
| `ACT_RU_JOB` | async jobs, timers, executable jobs |
| `ACT_RU_TIMER_JOB` | timer job pada versi tertentu/config modern |
| `ACT_RU_EXT_TASK` | external tasks |
| `ACT_RU_EVENT_SUBSCR` | message/signal/compensation/event subscriptions |
| `ACT_RU_INCIDENT` | active incidents |
| `ACT_RU_IDENTITYLINK` | candidate users/groups, task/process identity links |
| `ACT_RU_AUTHORIZATION` | authorization runtime/config |
| `ACT_RU_METER_LOG` | runtime metrics log |
| `ACT_RU_TASK_METER_LOG` | task metrics log |
| `ACT_RU_BATCH` | active batch operations |

Nama dan detail bisa berubah antar versi; selalu cek schema sesuai versi engine Anda.

---

## 6. `ACT_RU_EXECUTION` — Jantung Runtime BPMN

`ACT_RU_EXECUTION` adalah tabel yang paling sering disalahpahami.

Banyak orang berharap satu process instance = satu row. Itu salah.

Satu process instance bisa punya banyak execution row karena:

- parallel gateway,
- embedded subprocess,
- event subprocess,
- boundary event,
- multi-instance,
- compensation,
- concurrent execution,
- scope execution,
- call activity relation.

### 6.1 Apa Itu Execution Row?

Execution row adalah node dalam execution tree.

Sebuah row bisa merepresentasikan:

- root process instance execution,
- child execution pada activity tertentu,
- scope execution,
- concurrent path,
- event scope,
- multi-instance body,
- execution yang sedang transition.

Kolom yang sering berguna:

| Kolom | Makna Umum |
|---|---|
| `ID_` | execution id |
| `PROC_INST_ID_` | process instance id/root id |
| `BUSINESS_KEY_` | business key pada root process instance |
| `PROC_DEF_ID_` | process definition id |
| `ACT_ID_` | current activity id jika execution ada di activity |
| `PARENT_ID_` | parent execution id |
| `SUPER_EXEC_` | relation ke parent call activity untuk subprocess/called process |
| `ROOT_PROC_INST_ID_` | root process instance id |
| `IS_ACTIVE_` | active flag |
| `IS_CONCURRENT_` | concurrent execution flag |
| `IS_SCOPE_` | scope execution flag |
| `IS_EVENT_SCOPE_` | event scope flag |
| `SUSPENSION_STATE_` | active/suspended |
| `REV_` | revision untuk optimistic locking |
| `TENANT_ID_` | tenant id |

### 6.2 Query Execution Tree

Query dasar:

```sql
SELECT ID_, PROC_INST_ID_, PARENT_ID_, ACT_ID_, IS_ACTIVE_, IS_CONCURRENT_, IS_SCOPE_, IS_EVENT_SCOPE_, REV_
FROM ACT_RU_EXECUTION
WHERE PROC_INST_ID_ = :process_instance_id
ORDER BY PARENT_ID_, ID_;
```

Untuk Oracle, PostgreSQL, MySQL, SQL Server, syntax recursive query berbeda. Tetapi prinsipnya sama: Anda ingin membaca parent-child execution.

Pseudo tree:

```text
PROC_INST_ID = P1

E1 root scope, ACT_ID_=null
├── E2 concurrent path, ACT_ID_=reviewTask
└── E3 concurrent path, ACT_ID_=waitForPayment
```

Jangan menafsirkan `ACT_ID_ IS NULL` sebagai “tidak ada aktivitas”. Root/scope execution bisa tidak berada di activity langsung tetapi tetap penting sebagai container.

### 6.3 Execution vs Activity Instance

Camunda menyediakan activity instance tree lewat API. Activity instance tree lebih ramah untuk operator karena memetakan state ke BPMN activity.

Execution tree lebih internal.

Mapping keduanya tidak selalu 1:1.

Contoh:

- satu activity instance bisa punya beberapa execution internal;
- scope execution bisa tidak terlihat sebagai activity aktif;
- transition instance bisa muncul saat async continuation/transition;
- multi-instance body punya struktur khusus.

Prinsip:

```text
Untuk UI/operator -> gunakan ActivityInstance API/Cockpit.
Untuk low-level diagnosis -> baca ACT_RU_EXECUTION dengan hati-hati.
```

### 6.4 Root Process Instance

Biasanya root process instance memiliki:

- `ID_ = PROC_INST_ID_`,
- `PARENT_ID_ IS NULL`,
- `BUSINESS_KEY_` terisi jika diset,
- `PROC_DEF_ID_` mengarah ke exact process definition.

Query root:

```sql
SELECT ID_, PROC_INST_ID_, BUSINESS_KEY_, PROC_DEF_ID_, ACT_ID_, SUSPENSION_STATE_, TENANT_ID_
FROM ACT_RU_EXECUTION
WHERE ID_ = PROC_INST_ID_
  AND PROC_INST_ID_ = :process_instance_id;
```

### 6.5 Mencari Process Instance by Business Key

```sql
SELECT ID_, PROC_INST_ID_, BUSINESS_KEY_, PROC_DEF_ID_, ACT_ID_, SUSPENSION_STATE_
FROM ACT_RU_EXECUTION
WHERE BUSINESS_KEY_ = :business_key
  AND ID_ = PROC_INST_ID_;
```

Jika banyak row muncul untuk satu business key, evaluasi:

- business key tidak unique secara global;
- process key berbeda memakai business key sama;
- tenant berbeda;
- duplicate start;
- retry/idempotency problem;
- domain lifecycle memang mengizinkan beberapa process instance.

Untuk production, business key harus punya desain uniqueness eksplisit:

```text
businessKey = <domainType>:<domainId>
example     = enforcement-case:CASE-2026-000123
```

Jika tenant dipakai:

```text
businessKey = <tenant>:<domainType>:<domainId>
```

Atau tenant disimpan di tenant id dan business key tetap domain-local, tetapi query harus tenant-aware.

---

## 7. `ACT_RU_TASK` — Open Human Work

`ACT_RU_TASK` berisi user task yang sedang terbuka.

Dokumentasi Camunda menyebut tabel ini berisi semua open tasks dari running process instances, termasuk process instance, execution, creation time, assignee, due date, dan metadata lain.

### 7.1 Mental Model Task Row

User task bukan sekadar row todo.

User task adalah wait state dalam execution tree.

Ketika task terbuka:

```text
ACT_RU_EXECUTION  -> execution menunggu di user task activity
ACT_RU_TASK       -> task yang dapat diklaim/dicomplete user
ACT_RU_IDENTITYLINK -> candidate user/group/assignee relation
ACT_RU_VARIABLE   -> variable process/task local jika ada
ACT_HI_TASKINST   -> historical projection jika history aktif
```

### 7.2 Kolom Penting

| Kolom | Makna Umum |
|---|---|
| `ID_` | task id |
| `REV_` | optimistic locking revision |
| `EXECUTION_ID_` | execution yang menunggu task |
| `PROC_INST_ID_` | process instance id |
| `PROC_DEF_ID_` | process definition id |
| `TASK_DEF_KEY_` | BPMN user task id |
| `NAME_` | task name |
| `ASSIGNEE_` | assigned user |
| `OWNER_` | owner/delegation owner |
| `CREATE_TIME_` | created at |
| `DUE_DATE_` | due date |
| `FOLLOW_UP_DATE_` | follow-up date |
| `PRIORITY_` | priority |
| `SUSPENSION_STATE_` | active/suspended |
| `TENANT_ID_` | tenant id |

### 7.3 Query Open Task by Case

```sql
SELECT t.ID_, t.NAME_, t.TASK_DEF_KEY_, t.ASSIGNEE_, t.CREATE_TIME_, t.DUE_DATE_, t.PRIORITY_, t.SUSPENSION_STATE_
FROM ACT_RU_TASK t
JOIN ACT_RU_EXECUTION e ON e.PROC_INST_ID_ = t.PROC_INST_ID_ AND e.ID_ = e.PROC_INST_ID_
WHERE e.BUSINESS_KEY_ = :business_key
ORDER BY t.CREATE_TIME_ DESC;
```

### 7.4 Candidate Groups and Identity Links

Candidate group/user tidak selalu ada di `ACT_RU_TASK`. Ia biasanya ada di `ACT_RU_IDENTITYLINK`.

Query:

```sql
SELECT l.TYPE_, l.USER_ID_, l.GROUP_ID_, l.TASK_ID_, l.PROC_INST_ID_
FROM ACT_RU_IDENTITYLINK l
WHERE l.TASK_ID_ = :task_id;
```

Jika task tidak muncul di inbox user:

- cek `ASSIGNEE_`;
- cek identity links;
- cek user group mapping;
- cek authorization;
- cek tenant;
- cek task suspended;
- cek query filter Tasklist/custom UI;
- cek process definition version;
- cek task local variables used by filter.

### 7.5 Jangan Treat Task sebagai Domain Entity

Anti-pattern:

```text
Aplikasi bisnis menyimpan semua status case berdasarkan ACT_RU_TASK.
```

Masalah:

- task hilang saat complete;
- task bisa multi-instance;
- task bisa paralel;
- task bukan domain state tunggal;
- task name bisa berubah antar version;
- task id generated;
- process modification bisa menciptakan task baru;
- migration bisa mengubah mapping.

Pattern lebih baik:

- domain case table menyimpan aggregate state;
- Camunda process menyimpan orchestration state;
- task UI membaca task dari engine API;
- audit/reporting memakai history atau projection khusus;
- domain invariant tidak bergantung pada keberadaan satu row task.

---

## 8. `ACT_RU_VARIABLE` — Runtime Variable Store

`ACT_RU_VARIABLE` menyimpan variable yang saat ini aktif pada process/task scope.

Dokumentasi Camunda menyebut tabel ini berisi process atau task variables yang saat ini diset, termasuk nama, tipe, value, dan relasi ke process instance/task.

### 8.1 Variable Bukan Domain Database

Ini prinsip keras:

> Camunda variable adalah orchestration state, bukan pengganti relational domain model.

Variable cocok untuk:

- routing decision,
- process control data,
- small payload snapshot,
- correlation key tambahan,
- transient context,
- form data sederhana,
- reference id ke domain object.

Variable buruk untuk:

- dokumen besar,
- array besar,
- audit utama,
- frequently updated business aggregate,
- reporting analytical source,
- high-cardinality searchable attributes tanpa index strategy,
- source of truth data transaksi.

### 8.2 Kolom Penting

| Kolom | Makna Umum |
|---|---|
| `ID_` | variable id |
| `TYPE_` | type variable |
| `NAME_` | variable name |
| `PROC_INST_ID_` | process instance id |
| `EXECUTION_ID_` | execution scope id |
| `TASK_ID_` | task local variable id jika task local |
| `BYTEARRAY_ID_` | reference ke `ACT_GE_BYTEARRAY` untuk serialized/binary value |
| `DOUBLE_`, `LONG_`, `TEXT_`, `TEXT2_` | value fields tergantung type |
| `VAR_SCOPE_` | variable scope |
| `REV_` | revision |
| `TENANT_ID_` | tenant id |

### 8.3 Query Variables by Process Instance

```sql
SELECT NAME_, TYPE_, TEXT_, TEXT2_, LONG_, DOUBLE_, BYTEARRAY_ID_, EXECUTION_ID_, TASK_ID_
FROM ACT_RU_VARIABLE
WHERE PROC_INST_ID_ = :process_instance_id
ORDER BY NAME_;
```

Interpretasi:

- `TEXT_` bisa berisi string atau serialized metadata;
- `TEXT2_` bisa berisi secondary text metadata;
- `BYTEARRAY_ID_` menunjukkan payload disimpan di `ACT_GE_BYTEARRAY`;
- `TASK_ID_` terisi berarti task local variable;
- variable bisa shadowing antar scope.

### 8.4 Variable Scope Problem

Contoh masalah:

```text
Parent process variable: approvalStatus = PENDING
Subprocess local variable: approvalStatus = APPROVED
```

Jika delegate membaca variable dengan API yang mencari parent scope, hasil bisa berbeda tergantung scope.

SQL bisa menunjukkan dua row dengan nama sama tetapi scope berbeda.

Query:

```sql
SELECT NAME_, TYPE_, EXECUTION_ID_, TASK_ID_, TEXT_, LONG_, BYTEARRAY_ID_
FROM ACT_RU_VARIABLE
WHERE PROC_INST_ID_ = :process_instance_id
  AND NAME_ = 'approvalStatus';
```

Jika hasil lebih dari satu:

- cek execution tree;
- tentukan scope yang benar;
- hindari nama variable ambiguous;
- gunakan naming convention;
- prefer DTO control variable yang kecil dan eksplisit.

### 8.5 Serialized Object Problem

Object variable Java biasanya menyimpan serialized representation dan class metadata.

Risiko:

- class berubah antar deployment;
- package rename;
- serialVersionUID mismatch;
- deserialization error;
- security risk;
- migration sulit;
- REST client non-Java sulit membaca;
- history menyimpan payload besar.

Pattern yang lebih aman:

```text
process variable: caseId = "CASE-2026-000123"
process variable: decisionSnapshotJson = small versioned JSON
business data: domain DB / document store
```

Jika JSON perlu disimpan:

- gunakan explicit schema version;
- batasi ukuran;
- jangan simpan seluruh aggregate besar;
- jangan taruh PII berlebihan;
- jangan query JSON via engine table kecuali benar-benar dirancang.

---

## 9. `ACT_GE_BYTEARRAY` — Blob, Serialized Values, Resources

`ACT_GE_BYTEARRAY` termasuk keluarga general data. Ia sering menjadi salah satu tabel terbesar di production.

Berisi berbagai binary payload seperti:

- BPMN XML resource,
- diagram resource,
- serialized object variable,
- file variable,
- large string/bytes,
- exception stacktrace/error details,
- decision resources,
- deployment resources,
- history variable detail payload tertentu.

### 9.1 Kenapa `ACT_GE_BYTEARRAY` Bisa Membesar?

Penyebab umum:

1. File upload disimpan sebagai process variable.
2. Object variable besar.
3. JSON/XML besar.
4. History level `FULL` menyimpan intermediate variable updates.
5. Exception details/job logs banyak.
6. Repeated deployments menyimpan resource berulang.
7. Tidak ada history cleanup atau cleanup tidak efektif.
8. Long-running process menyimpan payload besar lama.

### 9.2 Query Ukuran Byte Array

Syntax berbeda per DB. Secara konseptual:

```sql
SELECT NAME_, DEPLOYMENT_ID_, GENERATED_, COUNT(*) AS CNT
FROM ACT_GE_BYTEARRAY
GROUP BY NAME_, DEPLOYMENT_ID_, GENERATED_
ORDER BY CNT DESC;
```

Untuk DB yang bisa menghitung blob length:

```sql
-- PostgreSQL example idea, adapt to actual column type
SELECT NAME_, COUNT(*) AS CNT, SUM(OCTET_LENGTH(BYTES_)) AS TOTAL_BYTES
FROM ACT_GE_BYTEARRAY
GROUP BY NAME_
ORDER BY TOTAL_BYTES DESC;
```

Oracle bisa memakai `DBMS_LOB.GETLENGTH(BYTES_)` jika `BYTES_` adalah BLOB/CLOB sesuai schema.

### 9.3 Jangan Delete ByteArray Manual

Ini sangat penting.

`ACT_GE_BYTEARRAY` bisa direferensikan dari banyak konteks:

- deployment resource,
- variable,
- job exception,
- external task error details,
- historic detail,
- historic variable,
- form/resource.

Manual delete bisa menyebabkan:

- variable gagal dibaca;
- process definition XML hilang;
- deployment corrupt;
- Cockpit error;
- history corrupt;
- migration gagal;
- job/external task error details hilang.

Gunakan:

- delete deployment API jika resource tidak lagi dipakai;
- history cleanup;
- history deletion API;
- process instance deletion dengan cascade sesuai kebutuhan;
- custom archival yang membaca API/history lalu menghapus via supported API.

### 9.4 Production Rule untuk Payload

Rule praktis:

```text
Camunda variable should carry references and compact process-control facts.
Large documents belong outside Camunda, referenced by documentId/storageKey.
```

Untuk regulatory system:

- dokumen evidence di document service/S3/object store;
- Camunda variable menyimpan `documentId`, `evidenceBundleId`, `caseId`;
- audit trail domain menyimpan immutable business event;
- Camunda history menyimpan process evidence.

---

## 10. `ACT_RU_JOB` dan Job-Related Runtime Tables

Pada part 005 kita sudah membahas job executor. Di sini kita lihat schema-level diagnosis.

### 10.1 Job Mental Model di DB

Job adalah durable instruction untuk engine agar melanjutkan pekerjaan nanti.

Job bisa berasal dari:

- async continuation,
- timer event,
- async event handling,
- batch seed/execution/monitor,
- history cleanup,
- process instance migration batch,
- external task timeout handling pada mekanisme tertentu,
- retry execution.

Tabel dan struktur job bisa berbeda antar versi karena Camunda memperkenalkan job table separation seperti timer/suspended/deadletter/batch pada beberapa versi. Tetapi `ACT_RU_JOB` tetap konsep sentral yang perlu dipahami.

### 10.2 Kolom Penting `ACT_RU_JOB`

| Kolom | Makna Umum |
|---|---|
| `ID_` | job id |
| `REV_` | optimistic locking revision |
| `TYPE_` | job type |
| `LOCK_OWNER_` | node/thread owner yang mengunci job |
| `LOCK_EXP_TIME_` | lease expiration |
| `EXCLUSIVE_` | exclusive job flag |
| `EXECUTION_ID_` | related execution |
| `PROCESS_INSTANCE_ID_` | process instance id |
| `PROCESS_DEF_ID_` | process definition id |
| `RETRIES_` | retry count left |
| `EXCEPTION_STACK_ID_` | reference ke bytearray stacktrace |
| `EXCEPTION_MSG_` | short exception message |
| `DUEDATE_` | executable due date |
| `REPEAT_` | timer repeat expression |
| `HANDLER_TYPE_` | handler type |
| `HANDLER_CFG_` | handler config |
| `DEPLOYMENT_ID_` | deployment relation |
| `PRIORITY_` | job priority |
| `TENANT_ID_` | tenant id |

### 10.3 Query Failed Jobs

```sql
SELECT ID_, TYPE_, PROCESS_INSTANCE_ID_, EXECUTION_ID_, RETRIES_, DUEDATE_, LOCK_OWNER_, LOCK_EXP_TIME_, EXCEPTION_MSG_, HANDLER_TYPE_, PRIORITY_
FROM ACT_RU_JOB
WHERE RETRIES_ = 0
ORDER BY DUEDATE_ ASC;
```

### 10.4 Query Locked Jobs

```sql
SELECT ID_, TYPE_, PROCESS_INSTANCE_ID_, RETRIES_, DUEDATE_, LOCK_OWNER_, LOCK_EXP_TIME_
FROM ACT_RU_JOB
WHERE LOCK_OWNER_ IS NOT NULL
ORDER BY LOCK_EXP_TIME_ DESC;
```

Interpretasi:

- `LOCK_OWNER_` terisi berarti job sedang/baru saja diakuisisi node;
- `LOCK_EXP_TIME_` bukan business timeout;
- jika `LOCK_EXP_TIME_` jauh di masa lalu tetapi job masih locked, ada kemungkinan node mati dan job belum reacquired karena query/filter/backoff;
- jika job terus terkunci oleh owner berbeda, bisa ada retry loop.

### 10.5 Query Job Delay

```sql
SELECT ID_, TYPE_, PROCESS_INSTANCE_ID_, RETRIES_, DUEDATE_, PRIORITY_, LOCK_OWNER_, LOCK_EXP_TIME_
FROM ACT_RU_JOB
WHERE RETRIES_ > 0
  AND (DUEDATE_ IS NULL OR DUEDATE_ <= CURRENT_TIMESTAMP)
  AND (LOCK_EXP_TIME_ IS NULL OR LOCK_EXP_TIME_ < CURRENT_TIMESTAMP)
ORDER BY PRIORITY_ DESC, DUEDATE_ ASC;
```

Catatan:

- syntax timestamp berbeda per DB;
- Camunda job acquisition query bisa punya ordering/config berbeda;
- custom index mungkin diperlukan jika query production sering dipakai.

### 10.6 Membaca Exception Details

`EXCEPTION_STACK_ID_` menunjuk ke `ACT_GE_BYTEARRAY`.

Query konseptual:

```sql
SELECT j.ID_, j.EXCEPTION_MSG_, b.NAME_, b.BYTES_
FROM ACT_RU_JOB j
LEFT JOIN ACT_GE_BYTEARRAY b ON b.ID_ = j.EXCEPTION_STACK_ID_
WHERE j.ID_ = :job_id;
```

Jangan tampilkan stacktrace besar sembarangan ke UI. Stacktrace bisa mengandung:

- internal hostnames,
- SQL,
- request payload,
- classpath,
- secrets yang tidak sengaja masuk log,
- PII.

### 10.7 Job Incident Relation

Jika retry habis, incident biasanya tercatat di `ACT_RU_INCIDENT`.

Query:

```sql
SELECT i.ID_, i.INCIDENT_TYPE_, i.INCIDENT_MSG_, i.PROC_INST_ID_, i.EXECUTION_ID_, i.ACTIVITY_ID_, i.CAUSE_INCIDENT_ID_, i.ROOT_CAUSE_INCIDENT_ID_, i.CONFIGURATION_, i.INCIDENT_TIMESTAMP_
FROM ACT_RU_INCIDENT i
ORDER BY i.INCIDENT_TIMESTAMP_ DESC;
```

`CONFIGURATION_` sering berisi id terkait, misalnya job id, tergantung incident type.

---

## 11. `ACT_RU_EXT_TASK` — External Task Runtime

External task adalah pola pull-based worker. State-nya disimpan di runtime table external task.

### 11.1 Mental Model

Saat process mencapai external service task:

```text
Execution waits at external task activity
ACT_RU_EXT_TASK row created
Worker fetchAndLock by topic
Worker completes/fails/BPMN-error via API
```

External task bukan `ACT_RU_JOB` biasa. Ia punya lifecycle worker sendiri:

- topic,
- worker id,
- lock expiration,
- retries,
- error details,
- priority.

### 11.2 Kolom Penting

| Kolom | Makna Umum |
|---|---|
| `ID_` | external task id |
| `TOPIC_NAME_` | topic worker |
| `WORKER_ID_` | current lock owner worker |
| `LOCK_EXP_TIME_` | lock lease expiration |
| `RETRIES_` | retries left |
| `ERROR_MSG_` | short error message |
| `ERROR_DETAILS_ID_` | bytearray id for details |
| `EXECUTION_ID_` | execution id |
| `PROC_INST_ID_` | process instance id |
| `PROC_DEF_ID_` | process definition id |
| `ACT_ID_` | BPMN activity id |
| `PRIORITY_` | priority |
| `TENANT_ID_` | tenant id |

### 11.3 Query External Task Backlog

```sql
SELECT TOPIC_NAME_, COUNT(*) AS CNT
FROM ACT_RU_EXT_TASK
GROUP BY TOPIC_NAME_
ORDER BY CNT DESC;
```

### 11.4 Query Locked External Tasks

```sql
SELECT ID_, TOPIC_NAME_, WORKER_ID_, LOCK_EXP_TIME_, RETRIES_, ERROR_MSG_, PROC_INST_ID_, ACT_ID_
FROM ACT_RU_EXT_TASK
WHERE WORKER_ID_ IS NOT NULL
ORDER BY LOCK_EXP_TIME_ DESC;
```

### 11.5 Query Failed External Tasks

```sql
SELECT ID_, TOPIC_NAME_, RETRIES_, ERROR_MSG_, PROC_INST_ID_, ACT_ID_, LOCK_EXP_TIME_
FROM ACT_RU_EXT_TASK
WHERE RETRIES_ = 0
ORDER BY TOPIC_NAME_, ACT_ID_;
```

### 11.6 External Task Diagnosis

Jika backlog meningkat:

- worker mati;
- topic name mismatch;
- worker tidak fetch tenant tertentu;
- lock duration terlalu panjang;
- retry habis;
- worker throughput kurang;
- worker stuck karena remote dependency;
- fetch variable payload terlalu besar;
- long polling config tidak optimal;
- worker id collision;
- process model meledakkan jumlah external tasks.

---

## 12. `ACT_RU_EVENT_SUBSCR` — Message, Signal, Compensation, Event Wait State

`ACT_RU_EVENT_SUBSCR` menyimpan event subscription aktif.

Dokumentasi Camunda menyebut tabel ini berisi event subscription yang sedang ada, termasuk type, name, configuration, process instance, dan execution.

### 12.1 Mental Model

Saat process menunggu message catch event:

```text
execution waits at message catch
ACT_RU_EVENT_SUBSCR row inserted
message correlation searches matching subscription
on correlation, row removed and execution continues
```

Untuk signal, subscription bisa broad. Untuk message, correlation lebih specific.

### 12.2 Kolom Penting

| Kolom | Makna Umum |
|---|---|
| `ID_` | subscription id |
| `EVENT_TYPE_` | message/signal/compensation/conditional etc |
| `EVENT_NAME_` | message/signal name |
| `EXECUTION_ID_` | execution id |
| `PROC_INST_ID_` | process instance id |
| `ACTIVITY_ID_` | BPMN activity id |
| `CONFIGURATION_` | additional config |
| `CREATED_` | created time |
| `TENANT_ID_` | tenant id |

### 12.3 Query Waiting Messages

```sql
SELECT EVENT_TYPE_, EVENT_NAME_, PROC_INST_ID_, EXECUTION_ID_, ACTIVITY_ID_, CREATED_, TENANT_ID_
FROM ACT_RU_EVENT_SUBSCR
WHERE EVENT_TYPE_ = 'message'
ORDER BY CREATED_ DESC;
```

### 12.4 Message Arrives Before Subscription

Classic failure:

```text
Service publishes MessagePaymentReceived
Process has not yet committed message catch subscription
Correlation fails: no matching execution
```

DB-level diagnosis:

- cek apakah subscription ada;
- cek event name;
- cek process instance id/business key;
- cek tenant;
- cek message correlation key variable;
- cek transaction boundary sebelum wait state;
- cek apakah previous async boundary diperlukan.

Pattern:

```text
External event should be durable and retryable.
Do not rely on one-shot message delivery if subscription may not exist yet.
```

---

## 13. `ACT_RU_INCIDENT` — Active Operational Failure

Incident adalah sinyal bahwa engine butuh intervensi operator atau retry configuration.

### 13.1 Incident Types

Umum:

- failed job,
- failed external task,
- failed batch,
- custom incident type.

Incident bukan sekadar log. Ia adalah runtime operational state.

### 13.2 Query Incident Dashboard

```sql
SELECT INCIDENT_TYPE_, ACTIVITY_ID_, PROC_DEF_ID_, COUNT(*) AS CNT
FROM ACT_RU_INCIDENT
GROUP BY INCIDENT_TYPE_, ACTIVITY_ID_, PROC_DEF_ID_
ORDER BY CNT DESC;
```

Kegunaan:

- melihat activity mana paling sering gagal;
- melihat process definition mana bermasalah;
- mendeteksi retry storm;
- memprioritaskan fix.

### 13.3 Incident Root Cause Chain

Kolom:

- `CAUSE_INCIDENT_ID_`,
- `ROOT_CAUSE_INCIDENT_ID_`.

Ini membantu melihat incident yang berhubungan. Jangan hanya lihat satu row.

### 13.4 Incident Handling

Jangan langsung set retry tanpa memahami failure:

```text
Set retries may re-execute side effect.
```

Checklist:

1. Baca process instance.
2. Baca activity id.
3. Baca job/external task.
4. Baca exception message/details.
5. Identifikasi apakah side effect sudah terjadi.
6. Pastikan delegate/worker idempotent.
7. Baru set retry/complete/manual modification.

---

## 14. `ACT_RU_IDENTITYLINK` dan Authorization-Related Runtime Tables

Identity link menghubungkan user/group dengan task atau process instance.

### 14.1 Identity Link

Contoh:

- candidate user,
- candidate group,
- assignee relation,
- owner relation,
- participant/starter depending feature.

Query task candidate:

```sql
SELECT TYPE_, USER_ID_, GROUP_ID_, TASK_ID_, PROC_INST_ID_
FROM ACT_RU_IDENTITYLINK
WHERE TASK_ID_ = :task_id;
```

### 14.2 Authorization Table

Camunda authorization model memakai runtime/config table seperti `ACT_RU_AUTHORIZATION`.

Jangan mengedit manual authorization kecuali benar-benar memahami bitmask permission model dan version-specific behavior.

Untuk security administration, gunakan:

- Admin UI,
- AuthorizationService,
- provisioning script via API.

### 14.3 Common Inbox Issue

Task ada di `ACT_RU_TASK`, tetapi user tidak melihatnya.

Urutan diagnosis:

```text
1. Task exists?
2. Task suspended?
3. Assignee set?
4. Candidate group/user exists?
5. User belongs to group?
6. Tenant matches?
7. Authorization permits READ/UPDATE/CLAIM?
8. Custom task filter excludes it?
9. Task local variable filter wrong?
10. UI cache/session stale?
```

---

## 15. Runtime Batch Tables

Batch dipakai untuk operasi besar seperti:

- process instance migration,
- process instance modification batch,
- deletion batch,
- historic process deletion,
- set retries async,
- external task operations,
- restart batch.

Tabel yang mungkin muncul:

- `ACT_RU_BATCH`,
- batch-related jobs,
- history batch tables.

Mental model:

```text
Batch = durable high-volume operation orchestrated by Camunda itself.
```

Ia membuat seed job, execution jobs, monitor job, dan history rows.

Production implication:

- batch bisa bersaing dengan business jobs;
- batch bisa menambah load DB;
- batch failure menghasilkan incidents;
- batch harus dijadwalkan sesuai maintenance window jika besar;
- batch jangan dianggap instantaneous.

Query konseptual:

```sql
SELECT ID_, TYPE_, TOTAL_JOBS_, JOBS_CREATED_, JOBS_PER_SEED_, INVOCATIONS_PER_JOB_, SEED_JOB_DEF_ID_, MONITOR_JOB_DEF_ID_, BATCH_JOB_DEF_ID_, TENANT_ID_
FROM ACT_RU_BATCH;
```

Kolom bisa berbeda antar versi; cek schema aktual.

---

## 16. Schema Family 3: `ACT_HI_*` — History and Audit Layer

`HI` stands for history.

History tables menjawab:

```text
Apa yang sudah terjadi?
Kapan process dimulai dan selesai?
Activity apa saja yang dilalui?
Task apa yang pernah ada?
Siapa mengerjakan apa?
Variable apa yang berubah?
Incident apa yang pernah terjadi?
Decision apa yang dievaluasi?
```

### 16.1 History Level

Camunda history level menentukan volume dan detail event history.

Level umum:

| Level | Karakter |
|---|---|
| `NONE` | tidak menyimpan history |
| `ACTIVITY` | process/activity/task lifecycle dasar |
| `AUDIT` | tambahan variable instance create/update/delete/migrate; biasanya default enterprise-relevant |
| `FULL` | tambahan form property update, variable update detail, user operation log detail lebih lengkap |

History level adalah trade-off:

```text
More history = better audit/debugging/reporting
More history = more write amplification/storage/cleanup cost
```

Untuk regulatory workflows, biasanya `AUDIT` atau `FULL` dipertimbangkan, tetapi harus diimbangi retention, cleanup, dan archival.

### 16.2 Tabel History Penting

| Tabel | Fungsi |
|---|---|
| `ACT_HI_PROCINST` | historic process instance |
| `ACT_HI_ACTINST` | historic activity instance |
| `ACT_HI_TASKINST` | historic task instance |
| `ACT_HI_VARINST` | historic variable instance latest value |
| `ACT_HI_DETAIL` | detail variable/form updates, especially FULL |
| `ACT_HI_COMMENT` | comments |
| `ACT_HI_ATTACHMENT` | attachments |
| `ACT_HI_OP_LOG` | user operation log |
| `ACT_HI_INCIDENT` | historic incidents |
| `ACT_HI_JOB_LOG` | historic job log |
| `ACT_HI_EXT_TASK_LOG` | external task log |
| `ACT_HI_DECINST` | historic decision instance |
| `ACT_HI_IDENTITYLINK` | historic identity link log |
| `ACT_HI_BATCH` | historic batch |

### 16.3 `ACT_HI_PROCINST`

Merekam process instance lifecycle.

Kolom penting:

| Kolom | Makna Umum |
|---|---|
| `ID_` | process instance id |
| `PROC_INST_ID_` | process instance id, tergantung schema |
| `BUSINESS_KEY_` | business key |
| `PROC_DEF_ID_` | process definition id |
| `PROC_DEF_KEY_` | process definition key |
| `START_TIME_` | start time |
| `END_TIME_` | end time |
| `DURATION_` | duration |
| `START_USER_ID_` | starter |
| `START_ACT_ID_` | start activity |
| `END_ACT_ID_` | end activity |
| `SUPER_PROCESS_INSTANCE_ID_` | call activity relation |
| `ROOT_PROC_INST_ID_` | root process |
| `STATE_` | state, tergantung version |
| `DELETE_REASON_` | reason if deleted |
| `TENANT_ID_` | tenant |
| `REMOVAL_TIME_` | cleanup eligibility time |

Query completed instances:

```sql
SELECT PROC_INST_ID_, BUSINESS_KEY_, PROC_DEF_KEY_, START_TIME_, END_TIME_, DURATION_, STATE_, DELETE_REASON_
FROM ACT_HI_PROCINST
WHERE BUSINESS_KEY_ = :business_key
ORDER BY START_TIME_ DESC;
```

### 16.4 `ACT_HI_ACTINST`

Merekam activity instance yang sudah started/ended.

Query timeline:

```sql
SELECT ACT_ID_, ACT_NAME_, ACT_TYPE_, START_TIME_, END_TIME_, DURATION_, ASSIGNEE_, EXECUTION_ID_
FROM ACT_HI_ACTINST
WHERE PROC_INST_ID_ = :process_instance_id
ORDER BY START_TIME_, END_TIME_;
```

Kegunaan:

- reconstruct path;
- lihat bottleneck duration;
- lihat activity yang belum selesai (`END_TIME_ IS NULL`);
- debug loop;
- audit path approval.

### 16.5 `ACT_HI_TASKINST`

Merekam task lifecycle.

Query task history:

```sql
SELECT ID_, TASK_DEF_KEY_, NAME_, ASSIGNEE_, OWNER_, START_TIME_, END_TIME_, DURATION_, DELETE_REASON_, DUE_DATE_, FOLLOW_UP_DATE_
FROM ACT_HI_TASKINST
WHERE PROC_INST_ID_ = :process_instance_id
ORDER BY START_TIME_;
```

Untuk regulatory audit, `ACT_HI_TASKINST` penting tetapi sering belum cukup. Anda juga perlu:

- user operation log;
- domain audit trail;
- comments;
- attachment metadata;
- decision outcome;
- task variables snapshot;
- authorization/access trail jika diperlukan.

### 16.6 `ACT_HI_VARINST` vs `ACT_HI_DETAIL`

`ACT_HI_VARINST` biasanya menyimpan latest historic value per variable.

`ACT_HI_DETAIL` menyimpan detail perubahan variable/form update, terutama jika history `FULL`.

Perbedaan:

```text
ACT_HI_VARINST = final/latest known variable state
ACT_HI_DETAIL  = sequence of changes/events/details
```

Jika user bertanya “nilai akhir approvalStatus apa?”, `ACT_HI_VARINST` mungkin cukup.

Jika user bertanya “siapa mengubah approvalStatus dari PENDING ke APPROVED, kapan, dari task mana?”, Anda mungkin perlu `ACT_HI_DETAIL`, `ACT_HI_OP_LOG`, dan domain audit.

### 16.7 History Tables Tidak Selalu Punya FK

Dokumentasi Camunda menyatakan history tables tidak memiliki foreign key constraints agar konfigurasi berbeda dan fleksibilitas lebih terjaga.

Implikasi:

- jangan mengandalkan FK database untuk menjaga history consistency;
- deletion/cleanup harus lewat supported mechanism;
- reporting query harus tahan missing relation;
- join harus left join jika data historical tidak lengkap;
- migrated/deleted/cascade cases bisa meninggalkan pola data yang tidak seperti runtime.

---

## 17. Schema Family 4: `ACT_GE_*` — General Infrastructure Data

`GE` stands for general.

Tabel umum:

| Tabel | Fungsi |
|---|---|
| `ACT_GE_BYTEARRAY` | binary/blob/resource/serialized payload |
| `ACT_GE_PROPERTY` | engine properties |
| `ACT_GE_SCHEMA_LOG` | schema version/update log |

### 17.1 `ACT_GE_PROPERTY`

Menyimpan property engine seperti schema version dan next db id tergantung id generator/config.

Query:

```sql
SELECT NAME_, VALUE_, REV_
FROM ACT_GE_PROPERTY
ORDER BY NAME_;
```

Gunakan untuk diagnosis, bukan manual edit.

### 17.2 `ACT_GE_SCHEMA_LOG`

Mencatat history update schema.

Dokumentasi Camunda menyebut table ini berisi history version schema; update script menambahkan entry version dan timestamp.

Query:

```sql
SELECT ID_, VERSION_, TIMESTAMP_
FROM ACT_GE_SCHEMA_LOG
ORDER BY TIMESTAMP_ DESC;
```

Kegunaan:

- verifikasi schema version;
- membandingkan environment;
- audit upgrade;
- debugging mismatch engine jar vs DB schema.

### 17.3 Schema Version Mismatch

Problem umum:

```text
Application upgraded Camunda library
Database schema not upgraded
```

Gejala:

- startup gagal;
- column not found;
- SQL exception;
- job executor error;
- query API gagal;
- rolling update gagal.

Rule:

```text
Engine binary version and database schema version must be managed as one release concern.
```

Jangan mengandalkan auto-update schema di production tanpa governance. Untuk production, migration script harus:

- reviewed;
- tested on copy of production;
- backed up;
- measured duration;
- coordinated with rolling update plan;
- validated by schema log.

---

## 18. Schema Family 5: `ACT_ID_*` — Identity Layer

`ID` stands for identity.

Tabel identity biasanya berisi:

- users,
- groups,
- memberships,
- tenants,
- tenant memberships,
- identity info.

Contoh:

| Tabel | Fungsi |
|---|---|
| `ACT_ID_USER` | user local Camunda |
| `ACT_ID_GROUP` | group local Camunda |
| `ACT_ID_MEMBERSHIP` | user-group membership |
| `ACT_ID_TENANT` | tenant |
| `ACT_ID_TENANT_MEMBER` | tenant membership |
| `ACT_ID_INFO` | extra user info |

### 18.1 Identity in Enterprise Reality

Banyak enterprise tidak memakai Camunda local identity sebagai source of truth.

Mereka memakai:

- LDAP,
- Active Directory,
- SAML/OIDC,
- Keycloak,
- custom IdentityProvider,
- Spring Security integration,
- external IAM.

Dalam konfigurasi seperti itu, `ACT_ID_*` bisa kosong atau tidak menjadi authoritative.

### 18.2 Jangan Campur Identity Model Tanpa Desain

Anti-pattern:

```text
Sebagian user/group dari LDAP, sebagian manual ACT_ID_*, sebagian dari app DB.
```

Dampak:

- inbox inconsistent;
- authorization sulit diaudit;
- group membership drift;
- task assignment tidak reproducible;
- user deactivation tidak sinkron;
- compliance gap.

Pattern:

- pilih identity source of truth;
- define provisioning/sync boundary;
- define group naming convention;
- define tenant boundary;
- audit user/group changes;
- avoid hardcoded personal user id di BPMN.

---

## 19. Relationship Map: How Core Tables Connect

Berikut peta konseptual simplified:

```text
ACT_RE_DEPLOYMENT
    |
    +-- ACT_RE_PROCDEF
            |
            +-- ACT_RU_EXECUTION (PROC_DEF_ID_)
                    |
                    +-- ACT_RU_TASK (EXECUTION_ID_, PROC_INST_ID_)
                    |       |
                    |       +-- ACT_RU_IDENTITYLINK (TASK_ID_)
                    |
                    +-- ACT_RU_VARIABLE (EXECUTION_ID_, PROC_INST_ID_)
                    |       |
                    |       +-- ACT_GE_BYTEARRAY (BYTEARRAY_ID_)
                    |
                    +-- ACT_RU_JOB (EXECUTION_ID_, PROCESS_INSTANCE_ID_)
                    |       |
                    |       +-- ACT_GE_BYTEARRAY (EXCEPTION_STACK_ID_)
                    |
                    +-- ACT_RU_EXT_TASK (EXECUTION_ID_, PROC_INST_ID_)
                    |
                    +-- ACT_RU_EVENT_SUBSCR (EXECUTION_ID_, PROC_INST_ID_)
                    |
                    +-- ACT_RU_INCIDENT (EXECUTION_ID_, PROC_INST_ID_)

ACT_HI_PROCINST / ACT_HI_ACTINST / ACT_HI_TASKINST / ACT_HI_VARINST / ...
    -> historical projection of runtime events
```

Catatan:

- diagram ini konseptual, bukan exact FK diagram;
- history tidak selalu punya FK constraints;
- beberapa relation implisit;
- nama kolom berbeda tergantung tabel/version;
- DMN/CMMN/batch menambah cabang lain.

---

## 20. Common End-to-End Lifecycle: What Rows Exist When?

Mari ambil process sederhana:

```text
Start
  -> Validate Application (service task asyncBefore)
  -> Review Application (user task)
  -> Wait for Payment (message catch)
  -> Finalize (service task asyncBefore)
  -> End
```

### 20.1 Deployment

Rows:

```text
ACT_RE_DEPLOYMENT
ACT_RE_PROCDEF
ACT_GE_BYTEARRAY (BPMN XML, diagram)
```

Tidak ada process runtime rows sebelum process dimulai.

### 20.2 Start Process

Jika start langsung menuju asyncBefore service task:

```text
ACT_RU_EXECUTION      root/execution state
ACT_RU_VARIABLE       initial variables
ACT_RU_JOB            async job for Validate Application
ACT_HI_PROCINST       if history enabled
ACT_HI_ACTINST        start/activity records depending history level
```

### 20.3 Job Executes Validate

Job executor mengambil job:

```text
ACT_RU_JOB.LOCK_OWNER_/LOCK_EXP_TIME_ updated
```

Jika success dan lanjut ke user task:

```text
ACT_RU_JOB            async job removed
ACT_RU_TASK           review task inserted
ACT_RU_EXECUTION      ACT_ID_ points/relates to user task wait state
ACT_RU_IDENTITYLINK   candidates if any
ACT_HI_TASKINST       task history created
ACT_HI_ACTINST        service task completed, user task started
```

### 20.4 User Completes Review

Saat `taskService.complete(...)`:

```text
ACT_RU_TASK           removed
ACT_RU_IDENTITYLINK   related rows removed
ACT_RU_VARIABLE       updated if complete variables provided
ACT_RU_EVENT_SUBSCR   message subscription inserted for payment
ACT_HI_TASKINST       end time updated
ACT_HI_ACTINST        review ended, message catch started
```

### 20.5 Payment Message Correlated

Saat message correlated:

```text
ACT_RU_EVENT_SUBSCR   removed
ACT_RU_JOB            async job inserted for Finalize if asyncBefore
ACT_RU_EXECUTION      moves to next state
ACT_HI_ACTINST        message catch ended
```

### 20.6 Finalize Job Success and End

```text
ACT_RU_JOB            removed
ACT_RU_EXECUTION      removed when process ends
ACT_RU_VARIABLE       removed when process ends
ACT_HI_PROCINST       end time set
ACT_HI_ACTINST        finalize/end recorded
ACT_HI_VARINST        retained depending history
```

Key insight:

```text
Runtime rows disappear after completion.
History rows survive until cleanup/deletion.
```

---

## 21. Safe SQL Diagnostic Playbook

### 21.1 Find Active Instance by Business Key

```sql
SELECT e.ID_, e.PROC_INST_ID_, e.BUSINESS_KEY_, e.PROC_DEF_ID_, e.ACT_ID_, e.SUSPENSION_STATE_, e.TENANT_ID_
FROM ACT_RU_EXECUTION e
WHERE e.ID_ = e.PROC_INST_ID_
  AND e.BUSINESS_KEY_ = :business_key;
```

### 21.2 Find Historic Instance by Business Key

```sql
SELECT h.PROC_INST_ID_, h.BUSINESS_KEY_, h.PROC_DEF_KEY_, h.PROC_DEF_ID_, h.START_TIME_, h.END_TIME_, h.STATE_, h.DELETE_REASON_, h.TENANT_ID_
FROM ACT_HI_PROCINST h
WHERE h.BUSINESS_KEY_ = :business_key
ORDER BY h.START_TIME_ DESC;
```

### 21.3 Show Active Runtime Shape

```sql
SELECT e.ID_, e.PARENT_ID_, e.ACT_ID_, e.IS_ACTIVE_, e.IS_SCOPE_, e.IS_CONCURRENT_, e.IS_EVENT_SCOPE_
FROM ACT_RU_EXECUTION e
WHERE e.PROC_INST_ID_ = :process_instance_id
ORDER BY e.PARENT_ID_, e.ID_;
```

### 21.4 Show Open Tasks

```sql
SELECT t.ID_, t.TASK_DEF_KEY_, t.NAME_, t.ASSIGNEE_, t.CREATE_TIME_, t.DUE_DATE_, t.PRIORITY_
FROM ACT_RU_TASK t
WHERE t.PROC_INST_ID_ = :process_instance_id
ORDER BY t.CREATE_TIME_;
```

### 21.5 Show Jobs

```sql
SELECT j.ID_, j.TYPE_, j.HANDLER_TYPE_, j.RETRIES_, j.DUEDATE_, j.LOCK_OWNER_, j.LOCK_EXP_TIME_, j.EXCEPTION_MSG_, j.PRIORITY_
FROM ACT_RU_JOB j
WHERE j.PROCESS_INSTANCE_ID_ = :process_instance_id
ORDER BY j.DUEDATE_;
```

### 21.6 Show External Tasks

```sql
SELECT x.ID_, x.TOPIC_NAME_, x.WORKER_ID_, x.LOCK_EXP_TIME_, x.RETRIES_, x.ERROR_MSG_, x.ACT_ID_
FROM ACT_RU_EXT_TASK x
WHERE x.PROC_INST_ID_ = :process_instance_id
ORDER BY x.TOPIC_NAME_, x.ACT_ID_;
```

### 21.7 Show Event Subscriptions

```sql
SELECT s.EVENT_TYPE_, s.EVENT_NAME_, s.ACTIVITY_ID_, s.EXECUTION_ID_, s.CREATED_
FROM ACT_RU_EVENT_SUBSCR s
WHERE s.PROC_INST_ID_ = :process_instance_id
ORDER BY s.CREATED_;
```

### 21.8 Show Incidents

```sql
SELECT i.ID_, i.INCIDENT_TYPE_, i.ACTIVITY_ID_, i.INCIDENT_MSG_, i.CONFIGURATION_, i.INCIDENT_TIMESTAMP_
FROM ACT_RU_INCIDENT i
WHERE i.PROC_INST_ID_ = :process_instance_id
ORDER BY i.INCIDENT_TIMESTAMP_ DESC;
```

### 21.9 Show Timeline

```sql
SELECT a.ACT_ID_, a.ACT_NAME_, a.ACT_TYPE_, a.START_TIME_, a.END_TIME_, a.DURATION_, a.ASSIGNEE_
FROM ACT_HI_ACTINST a
WHERE a.PROC_INST_ID_ = :process_instance_id
ORDER BY a.START_TIME_, a.END_TIME_;
```

---

## 22. Reading Camunda State Like a Forensic Engineer

Ketika ada incident production, jangan langsung bertanya:

```text
Task-nya di tabel mana?
```

Bertanyalah dengan urutan state machine:

1. Apakah process instance masih aktif?
2. Kalau aktif, execution sedang berada di activity apa?
3. Apakah ia sedang menunggu user task, job, external task, message, timer, atau suspended?
4. Kalau ada job, apakah retries habis?
5. Kalau ada external task, apakah locked terlalu lama?
6. Kalau ada event subscription, apakah message name/correlation key benar?
7. Kalau task ada, siapa assignee/candidate group?
8. Apakah incident aktif?
9. Apa historical path sebelum titik ini?
10. Apakah ada variable yang salah atau missing?
11. Apakah process definition version sesuai release yang diharapkan?
12. Apakah tenant/environment benar?

SQL diagnosis seharusnya mengikuti flow ini.

---

## 23. Production Problem Patterns and Schema Diagnosis

### 23.1 Process “Stuck”

Kemungkinan:

- sedang menunggu user task;
- sedang menunggu message;
- sedang menunggu timer;
- async job failed;
- external task failed;
- suspended;
- execution tree inconsistent karena manual DB change;
- job executor mati;
- worker mati;
- message correlation race.

Diagnosis:

```sql
-- active executions
SELECT * FROM ACT_RU_EXECUTION WHERE PROC_INST_ID_ = :pid;

-- tasks
SELECT * FROM ACT_RU_TASK WHERE PROC_INST_ID_ = :pid;

-- jobs
SELECT * FROM ACT_RU_JOB WHERE PROCESS_INSTANCE_ID_ = :pid;

-- external tasks
SELECT * FROM ACT_RU_EXT_TASK WHERE PROC_INST_ID_ = :pid;

-- event subscriptions
SELECT * FROM ACT_RU_EVENT_SUBSCR WHERE PROC_INST_ID_ = :pid;

-- incidents
SELECT * FROM ACT_RU_INCIDENT WHERE PROC_INST_ID_ = :pid;
```

Interpretation:

```text
Task exists       -> not stuck, waiting human work
Job retries=0     -> failed async/timer, resolve incident
External retries=0-> worker failure, resolve/retry
Event subscription-> waiting event, check correlation
No runtime rows   -> completed/deleted, check history
```

### 23.2 Duplicate Process Instances

Diagnosis:

```sql
SELECT BUSINESS_KEY_, PROC_DEF_ID_, COUNT(*) AS CNT
FROM ACT_RU_EXECUTION
WHERE ID_ = PROC_INST_ID_
GROUP BY BUSINESS_KEY_, PROC_DEF_ID_
HAVING COUNT(*) > 1;
```

History:

```sql
SELECT BUSINESS_KEY_, PROC_DEF_KEY_, COUNT(*) AS CNT
FROM ACT_HI_PROCINST
GROUP BY BUSINESS_KEY_, PROC_DEF_KEY_
HAVING COUNT(*) > 1;
```

Root causes:

- no idempotency guard at start;
- retrying caller starts process again;
- business key not unique;
- tenant missing;
- start event triggered by duplicate message;
- REST/API client timeout then retry;
- deployment version changed and caller does not detect duplicate.

Pattern:

- idempotency table in app DB;
- unique domain lifecycle constraint;
- start process within transactional outbox/command model;
- correlate-start carefully;
- use business key consistently.

### 23.3 Task Completed But Reappeared

Possible causes:

- transaction rollback after `taskService.complete`;
- async boundary after task not set and downstream delegate failed;
- optimistic locking caused retry/re-execution;
- user double submit;
- parallel multi-instance created more tasks;
- process model loops back.

Diagnosis:

```sql
SELECT * FROM ACT_HI_TASKINST WHERE PROC_INST_ID_ = :pid ORDER BY START_TIME_;
SELECT * FROM ACT_HI_ACTINST WHERE PROC_INST_ID_ = :pid ORDER BY START_TIME_;
SELECT * FROM ACT_RU_JOB WHERE PROCESS_INSTANCE_ID_ = :pid;
SELECT * FROM ACT_RU_INCIDENT WHERE PROC_INST_ID_ = :pid;
```

### 23.4 Job Executor Not Processing

Global query:

```sql
SELECT COUNT(*) AS executable_jobs
FROM ACT_RU_JOB
WHERE RETRIES_ > 0
  AND (DUEDATE_ IS NULL OR DUEDATE_ <= CURRENT_TIMESTAMP)
  AND (LOCK_EXP_TIME_ IS NULL OR LOCK_EXP_TIME_ < CURRENT_TIMESTAMP);
```

If count high:

- job executor disabled;
- acquisition blocked;
- DB index issue;
- cluster lock contention;
- deployment-aware mismatch;
- thread pool saturated;
- job priority config causing starvation;
- DB time mismatch;
- dead connection pool;
- node cannot deserialize delegate/class.

### 23.5 History Tables Exploding

Find large tables using DB catalog, then inspect:

- `ACT_HI_DETAIL`,
- `ACT_HI_VARINST`,
- `ACT_HI_ACTINST`,
- `ACT_HI_JOB_LOG`,
- `ACT_GE_BYTEARRAY`,
- `ACT_RU_METER_LOG`,
- `ACT_RU_TASK_METER_LOG`.

Root causes:

- history level full;
- variable updated repeatedly;
- large variables;
- no TTL/removal time;
- cleanup disabled or underprovisioned;
- long-running processes never end;
- batch operations create many logs;
- metrics retention overlooked.

---

## 24. Indexing and Query Discipline

### 24.1 Do Not Add Index Blindly

Adding index can help read queries but hurt writes.

Camunda runtime is write-heavy:

- moving token updates execution rows;
- completing task deletes/inserts rows;
- job executor frequently reads/locks/updates jobs;
- variables update revisions;
- history inserts many rows.

An index on hot runtime table adds write amplification.

### 24.2 Index Candidate Types

Indexes may be considered for:

- custom task inbox filters;
- history report queries;
- business key lookup;
- process definition key/time history queries;
- job acquisition tuning if Camunda docs recommend for config;
- cleanup performance;
- tenant-specific queries.

But for engine tables, always validate:

- actual query plan;
- row count;
- cardinality;
- write overhead;
- DB vendor behavior;
- Camunda version release notes;
- existing index;
- maintenance cost;
- rollback plan.

### 24.3 Custom Reporting Should Prefer Projection

Anti-pattern:

```text
Every dashboard query joins 8 ACT_* tables directly every 5 seconds.
```

Better pattern:

```text
Camunda history/events/API -> reporting projection -> dashboard
```

For regulatory/case management:

- build read model table;
- update by domain events/process events;
- store denormalized case status;
- keep Camunda tables for process engine;
- keep audit queries separate and controlled.

---

## 25. Database Vendor Differences

Camunda 7 supports multiple relational databases, but physical behavior differs.

### 25.1 Oracle

Consider:

- LOB segment growth;
- high water mark;
- undo/redo cost;
- sequence/id generation behavior;
- tablespace capacity;
- index bloat;
- CLOB/BLOB storage;
- execution plan statistics;
- row locking behavior;
- RAC/time sync if applicable.

Common operational issue:

```text
DELETE history rows but storage does not shrink immediately.
```

This is DB behavior, not Camunda-specific. Space may become reusable internally but not returned to OS/tablespace until segment maintenance/shrink/move depending DB.

### 25.2 PostgreSQL

Consider:

- MVCC bloat;
- autovacuum;
- `bytea`/TOAST storage;
- index bloat;
- `EXPLAIN ANALYZE`;
- transaction ID wraparound;
- vacuum cost during history cleanup;
- connection pool sizing.

### 25.3 MySQL/MariaDB

Consider:

- InnoDB locking;
- isolation level;
- index length;
- utf8mb4 size;
- online DDL behavior;
- history cleanup large deletes;
- deadlocks under high concurrency.

### 25.4 SQL Server

Consider:

- lock escalation;
- snapshot isolation configuration;
- parameter sniffing;
- tempdb pressure;
- index fragmentation;
- transaction log growth.

### 25.5 Cross-DB Rule

Never tune Camunda purely from generic SQL instinct.

Tune from:

```text
engine behavior + actual query plan + production workload + DB vendor internals
```

---

## 26. Runtime vs History: Correctness Implications

A subtle but critical principle:

```text
Runtime is authoritative for what can happen next.
History is authoritative for what has been observed/persisted as past event.
```

Do not use history to decide live continuation unless explicitly designed.

Example bad pattern:

```text
Delegate queries ACT_HI_TASKINST to decide if approval happened.
```

Problems:

- history async/level/config can differ;
- history cleanup can remove rows;
- history can be incomplete at lower level;
- history is audit projection, not domain source of truth;
- transaction timing can surprise you.

Better:

- process variable / domain state for control flow;
- history for audit/debug/reporting;
- domain audit event for compliance evidence.

---

## 27. Manual Cleanup: What Is Safe?

### 27.1 Unsafe by Default

Unsafe:

```sql
DELETE FROM ACT_RU_EXECUTION;
DELETE FROM ACT_RU_TASK;
DELETE FROM ACT_RU_JOB;
DELETE FROM ACT_RU_VARIABLE;
DELETE FROM ACT_GE_BYTEARRAY;
UPDATE ACT_RU_JOB SET RETRIES_ = 3;
UPDATE ACT_RU_EXECUTION SET ACT_ID_ = 'somewhere';
```

These bypass engine invariants.

### 27.2 Safer Supported Operations

Use:

- runtime deletion API;
- history deletion API;
- batch delete;
- history cleanup;
- repository delete deployment API;
- management service retry API;
- external task retry API;
- process modification API;
- process migration API;
- Cockpit/Admin operations.

### 27.3 Emergency Repair Checklist

Jika benar-benar harus manual SQL:

1. Stop all engine nodes and workers if mutation affects runtime.
2. Take full backup/snapshot.
3. Reproduce on cloned DB.
4. Identify exact Camunda version and schema.
5. Understand all referencing rows.
6. Prepare rollback script.
7. Get platform owner/DBA approval.
8. Execute in maintenance window.
9. Start one node first.
10. Run smoke tests.
11. Monitor incidents/jobs/tasks.
12. Document forensic reason.

Untuk engineer top-tier, “bisa manual fix” bukan berarti sering manual fix. Justru kemampuan senior terlihat dari menghindari kebutuhan manual fix lewat desain boundary yang benar.

---

## 28. Designing Domain Data Around Camunda Schema

Camunda schema harus diposisikan terhadap domain schema.

### 28.1 Recommended Separation

```text
Domain DB:
  CASE
  APPLICATION
  DECISION
  DOCUMENT
  AUDIT_EVENT
  ASSIGNMENT_POLICY
  SLA_POLICY
  USER_ACTION_LOG

Camunda DB:
  ACT_RE_*
  ACT_RU_*
  ACT_HI_*
  ACT_GE_*
  ACT_ID_*

Integration:
  businessKey = CASE.id
  variables = compact process control + references
```

### 28.2 Why Separation Matters

If Camunda is your only domain state:

- reporting becomes hard;
- migration becomes hard;
- Camunda 7 to 8 migration becomes harder;
- domain query performance suffers;
- audit semantics are tied to engine internals;
- business state disappears from runtime when process ends;
- process model changes become domain schema changes.

If domain DB is source of truth:

- Camunda orchestrates lifecycle;
- domain service owns invariants;
- process variable references domain id;
- audit can be engine-independent;
- migration path improves;
- reporting can use domain/read model.

### 28.3 Regulatory Case Management Example

Domain:

```text
CASE(id, status, assigned_unit, current_stage, created_at, closed_at)
CASE_PARTY(case_id, party_id, role)
CASE_DOCUMENT(case_id, document_id, type)
CASE_DECISION(case_id, decision_type, outcome, decided_by, decided_at)
CASE_AUDIT_EVENT(case_id, event_type, actor, timestamp, payload_hash)
```

Camunda variables:

```text
caseId = CASE-2026-000123
caseType = ENFORCEMENT
riskTier = HIGH
requiresLegalReview = true
currentEscalationLevel = 2
```

Do not store entire case aggregate as serialized Java object variable.

---

## 29. Schema Reading for Migration and Upgrade

Part 034 will cover migration, but schema mastery helps early.

### 29.1 Why Schema Matters for Migration

Camunda 7 to 8 is not a simple DB upgrade. Camunda 8 uses a different engine architecture.

Therefore, you need to know:

- active process instances by definition/version;
- long-running instances;
- history volume;
- process definitions still used;
- unresolved incidents;
- timer/message wait states;
- external task topics;
- variable serialization types;
- custom delegates/listeners;
- business key coverage;
- cleanup readiness.

### 29.2 Inventory Queries

Active instances per definition:

```sql
SELECT e.PROC_DEF_ID_, COUNT(*) AS CNT
FROM ACT_RU_EXECUTION e
WHERE e.ID_ = e.PROC_INST_ID_
GROUP BY e.PROC_DEF_ID_
ORDER BY CNT DESC;
```

Definitions with active instances:

```sql
SELECT p.KEY_, p.VERSION_, p.ID_, COUNT(e.ID_) AS ACTIVE_INSTANCES
FROM ACT_RE_PROCDEF p
LEFT JOIN ACT_RU_EXECUTION e ON e.PROC_DEF_ID_ = p.ID_ AND e.ID_ = e.PROC_INST_ID_
GROUP BY p.KEY_, p.VERSION_, p.ID_
ORDER BY p.KEY_, p.VERSION_;
```

Incidents per definition:

```sql
SELECT i.PROC_DEF_ID_, i.ACTIVITY_ID_, i.INCIDENT_TYPE_, COUNT(*) AS CNT
FROM ACT_RU_INCIDENT i
GROUP BY i.PROC_DEF_ID_, i.ACTIVITY_ID_, i.INCIDENT_TYPE_
ORDER BY CNT DESC;
```

Serialized variables by type:

```sql
SELECT TYPE_, COUNT(*) AS CNT
FROM ACT_RU_VARIABLE
GROUP BY TYPE_
ORDER BY CNT DESC;
```

These queries help define migration risk.

---

## 30. Security and Privacy Considerations

Camunda tables can contain sensitive data:

- variable values,
- user ids,
- assignee information,
- comments,
- attachments,
- exception messages,
- stacktraces,
- serialized payloads,
- business keys,
- tenant ids,
- decision inputs/outputs,
- form data.

### 30.1 Do Not Expose Raw ACT Tables to BI Broadly

If BI/reporting users get direct access:

- they may see PII;
- they may infer confidential case status;
- they may access stacktraces/secrets;
- they may create expensive queries;
- they may accidentally lock tables or run destructive queries.

Better:

- curated read replica;
- masked projection;
- least privilege SQL role;
- no write access;
- no blob access unless justified;
- query timeout/resource group;
- audit DB access;
- anonymize/pseudonymize where required.

### 30.2 Variable Design is Security Design

If you put secrets/PII in variables, they may appear in:

- runtime table,
- history table,
- bytearray,
- logs,
- Cockpit,
- REST API,
- backup,
- BI export,
- support dump.

Pattern:

```text
Do not store secret values as process variables.
Store secret references or vault keys with strict access control.
```

---

## 31. Java 8 to 25 Considerations Around Schema

Database schema itself is not Java-version-specific, but Java version affects runtime behavior and compatibility around:

- Camunda engine version supported by that Java version;
- JDBC driver version;
- connection pool behavior;
- serialization compatibility;
- date/time handling;
- module/classloading constraints;
- framework integration;
- Spring Boot/Jakarta transitions;
- bytecode target of delegates;
- deserialization of object variables.

### 31.1 Java Serialization Trap Across Versions

If process variables store Java serialized objects:

```text
Java 8 app writes serialized object
Java 17/21 app reads it later
Class changes or serialization filtering blocks it
Process fails at variable deserialization
```

Modern Java versions have stronger serialization filtering/security practices.

Pattern:

- avoid Java object serialization for long-running process state;
- use JSON with schema version;
- store domain id references;
- test upgrade with real variable payloads;
- scan `ACT_RU_VARIABLE`/`ACT_HI_VARINST` for object types before Java/Camunda upgrade.

### 31.2 JDBC Driver and DB Type Differences

Java upgrade often changes:

- JDBC driver;
- TLS defaults;
- timezone behavior;
- connection validation;
- statement caching;
- LOB streaming behavior;
- transaction isolation defaults through pool/framework.

Schema diagnosis after Java upgrade should include:

- job executor throughput;
- query latency;
- connection pool metrics;
- LOB read/write performance;
- transaction deadlocks;
- optimistic locking rate;
- DB CPU and waits.

---

## 32. Hands-On Lab: Build a Read-Only Diagnostic Notebook

### 32.1 Goal

Create a read-only SQL diagnostic notebook/script that answers:

1. Which process instances are active?
2. Which active instances have incidents?
3. Which jobs are executable but not processed?
4. Which external tasks are locked or failed?
5. Which process definitions have many active instances?
6. Which history tables are largest?
7. Which variables use byte arrays?
8. Which deployments happened recently?

### 32.2 Safety Requirements

- Use read-only DB user.
- No `SELECT *` on large tables in production.
- Add time filters/limits.
- Avoid reading blob bytes by default.
- Do not expose PII broadly.
- Use query timeout.
- Run heavy reports on replica if possible.

### 32.3 Example Query Pack

Recent deployments:

```sql
SELECT ID_, NAME_, DEPLOY_TIME_, SOURCE_, TENANT_ID_
FROM ACT_RE_DEPLOYMENT
ORDER BY DEPLOY_TIME_ DESC;
```

Active instances by definition:

```sql
SELECT p.KEY_, p.VERSION_, COUNT(e.ID_) AS ACTIVE_INSTANCES
FROM ACT_RE_PROCDEF p
JOIN ACT_RU_EXECUTION e ON e.PROC_DEF_ID_ = p.ID_ AND e.ID_ = e.PROC_INST_ID_
GROUP BY p.KEY_, p.VERSION_
ORDER BY ACTIVE_INSTANCES DESC;
```

Failed jobs by activity:

```sql
SELECT j.PROCESS_DEF_ID_, j.HANDLER_TYPE_, j.RETRIES_, COUNT(*) AS CNT
FROM ACT_RU_JOB j
WHERE j.RETRIES_ = 0
GROUP BY j.PROCESS_DEF_ID_, j.HANDLER_TYPE_, j.RETRIES_
ORDER BY CNT DESC;
```

Open tasks by task definition:

```sql
SELECT t.PROC_DEF_ID_, t.TASK_DEF_KEY_, t.NAME_, COUNT(*) AS CNT
FROM ACT_RU_TASK t
GROUP BY t.PROC_DEF_ID_, t.TASK_DEF_KEY_, t.NAME_
ORDER BY CNT DESC;
```

Event subscriptions by event name:

```sql
SELECT EVENT_TYPE_, EVENT_NAME_, ACTIVITY_ID_, COUNT(*) AS CNT
FROM ACT_RU_EVENT_SUBSCR
GROUP BY EVENT_TYPE_, EVENT_NAME_, ACTIVITY_ID_
ORDER BY CNT DESC;
```

External task backlog:

```sql
SELECT TOPIC_NAME_, ACT_ID_, RETRIES_, COUNT(*) AS CNT
FROM ACT_RU_EXT_TASK
GROUP BY TOPIC_NAME_, ACT_ID_, RETRIES_
ORDER BY CNT DESC;
```

Byte array usage by variable type:

```sql
SELECT TYPE_, COUNT(*) AS CNT
FROM ACT_RU_VARIABLE
WHERE BYTEARRAY_ID_ IS NOT NULL
GROUP BY TYPE_
ORDER BY CNT DESC;
```

Historic instance duration:

```sql
SELECT PROC_DEF_KEY_, COUNT(*) AS CNT, AVG(DURATION_) AS AVG_DURATION_MS, MAX(DURATION_) AS MAX_DURATION_MS
FROM ACT_HI_PROCINST
WHERE END_TIME_ IS NOT NULL
GROUP BY PROC_DEF_KEY_
ORDER BY AVG_DURATION_MS DESC;
```

Adapt functions like `AVG`, timestamp filtering, and blob length to your DB.

---

## 33. Common Misconceptions

### Misconception 1: “If process exists, it must have one row in `ACT_RU_EXECUTION`.”

Wrong. One process instance can have many execution rows.

### Misconception 2: “`ACT_RU_TASK` is the process status.”

Wrong. It is only open human task state.

### Misconception 3: “History tables are always complete audit.”

Wrong. Completeness depends on history level, cleanup, and what data you modelled.

### Misconception 4: “Deleting runtime rows is a valid way to cancel process.”

Wrong. Use engine API.

### Misconception 5: “`ACT_GE_BYTEARRAY` only stores BPMN XML.”

Wrong. It stores many binary payloads, including variable payloads and exception details.

### Misconception 6: “A job locked for a long time means business task is executing long.”

Not necessarily. Lock expiration is a lease mechanism for job executor, not a semantic business timeout.

### Misconception 7: “Business key is automatically unique.”

No. You must design uniqueness.

### Misconception 8: “Camunda tables are good enough for all reporting.”

Not usually. Use projections/read models for high-volume reporting.

---

## 34. Top 1% Mental Models

### 34.1 Database is the Engine’s Memory Across Time

Camunda 7 process engine is passive. It borrows threads, mutates state, and persists at wait states/transaction boundaries.

The database is not incidental. It is the durable memory of the engine.

### 34.2 Runtime Tables Are a Live State Machine Encoding

`ACT_RU_*` tables encode where the process can go next.

Do not corrupt them.

### 34.3 History Tables Are an Event Projection, Not the Engine Brain

History is for audit/debug/reporting. It is not the live control plane.

### 34.4 Byte Arrays Are a Risk Multiplier

Every large variable/file/object increases:

- storage,
- backup,
- cleanup,
- migration,
- deserialization,
- privacy,
- performance risk.

### 34.5 SQL Diagnosis Must Preserve Engine Invariants

A senior engineer uses SQL to understand, not to bypass.

### 34.6 Schema Mastery Enables Better Modelling

If you know how many rows your model creates, you model differently:

- avoid unnecessary async boundaries;
- avoid variable spam;
- avoid excessive history detail;
- avoid massive multi-instance fanout without capacity planning;
- avoid signal broadcast abuse;
- avoid unbounded timers;
- avoid huge serialized variables.

---

## 35. Checklist: Production Database Review for Camunda 7

Use this checklist during architecture review.

### 35.1 Schema and Version

- [ ] Engine version known.
- [ ] DB schema version known.
- [ ] `ACT_GE_SCHEMA_LOG` validated.
- [ ] Upgrade scripts managed manually in production.
- [ ] Rollback plan exists.

### 35.2 Runtime Health

- [ ] Active process count monitored.
- [ ] Job backlog monitored.
- [ ] Failed job count monitored.
- [ ] External task backlog monitored.
- [ ] Incident count monitored.
- [ ] Open task count monitored.
- [ ] Suspended instance count monitored.

### 35.3 Storage

- [ ] History table growth monitored.
- [ ] `ACT_GE_BYTEARRAY` growth monitored.
- [ ] Metrics table growth monitored.
- [ ] LOB storage monitored.
- [ ] Backup size monitored.
- [ ] Cleanup duration monitored.

### 35.4 History and Audit

- [ ] History level intentionally chosen.
- [ ] History TTL configured where needed.
- [ ] Removal time strategy understood.
- [ ] History cleanup enabled/tested.
- [ ] Regulatory retention aligned.
- [ ] Domain audit not replaced accidentally by engine history.

### 35.5 Variables

- [ ] No large document stored directly unless justified.
- [ ] No secrets stored as variables.
- [ ] Java object serialization avoided.
- [ ] JSON payload versioned.
- [ ] Variable names controlled.
- [ ] High-frequency variable updates minimized.

### 35.6 Query/Reporting

- [ ] Custom reports use replica/projection where possible.
- [ ] BI users do not have write access.
- [ ] Heavy SQL has limits/time filters.
- [ ] Custom indexes reviewed with DB plan.
- [ ] Reports do not depend on internal schema without version governance.

### 35.7 Operations

- [ ] DB connection pool sized for job executor and app API.
- [ ] Job executor tuning matches DB capacity.
- [ ] Cleanup jobs do not starve business jobs.
- [ ] Batch operations scheduled.
- [ ] Emergency SQL procedure documented but discouraged.

---

## 36. Summary

Camunda 7 database schema is where process reality becomes durable.

The five families are:

```text
ACT_RE_* = deployed executable definitions
ACT_RU_* = active runtime state
ACT_HI_* = historical/audit projection
ACT_GE_* = general binary/properties/schema infrastructure
ACT_ID_* = identity data
```

The most important production insight:

> Read the database to understand the engine. Mutate the engine through the engine API.

If you master the schema, you can:

- debug stuck processes;
- understand job backlog;
- diagnose failed external tasks;
- trace audit history;
- reason about performance;
- plan cleanup;
- prepare upgrades;
- estimate migration risk;
- prevent modelling decisions that explode storage or operational complexity.

But schema mastery must be paired with humility: the database is internal engine state. Treat it with the same care you would treat a consensus log, transaction journal, or kernel data structure.

---

## 37. References

- Camunda 7.24 Documentation — Database Schema: `https://docs.camunda.org/manual/7.24/user-guide/process-engine/database/database-schema/`
- Camunda 7.24 Documentation — Database Configuration: `https://docs.camunda.org/manual/7.24/user-guide/process-engine/database/database-configuration/`
- Camunda 7.24 Documentation — History Configuration: `https://docs.camunda.org/manual/7.24/user-guide/process-engine/history/history-configuration/`
- Camunda 7.24 Documentation — Job Executor: `https://docs.camunda.org/manual/7.24/user-guide/process-engine/the-job-executor/`
- Camunda 7.24 Documentation — Process Variables: `https://docs.camunda.org/manual/7.24/user-guide/process-engine/process-variables/`
- Camunda 7.24 Documentation — Incidents: `https://docs.camunda.org/manual/7.24/user-guide/process-engine/incidents/`
- Camunda 7.24 Documentation — History Cleanup: `https://docs.camunda.org/manual/7.24/user-guide/process-engine/history/history-cleanup/`

---

## 38. Status

Part 006 selesai.

Seri belum selesai. Lanjut ke:

`learn-java-camunda-7-bpm-platform-engineering-part-007.md`

Topik berikutnya:

**Persistence, Flush Ordering, Optimistic Locking, dan Database Isolation**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-005.md">⬅️ Part 005 — Job Executor Internals: Acquisition, Locking, Backoff, Deployment Awareness, dan Cluster Behavior</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-007.md">Part 007 — Persistence, Flush Ordering, Optimistic Locking, dan Database Isolation ➡️</a>
</div>
