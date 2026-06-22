# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-035.md

# Part 035 — Mastery Checklist, Engineering Heuristics, Interview-Level Depth, and Next Roadmap

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Bagian: `035`  
> Status: **Bagian terakhir seri**  
> Fokus: mengunci kemampuan berpikir, checklist production readiness, design-review heuristics, interview-level depth, dan roadmap lanjutan setelah menguasai Camunda 8/Zeebe.

---

## 0. Posisi Part Ini Dalam Seri

Bagian ini bukan tempat untuk menambah API baru.

Bagian ini adalah tempat untuk memastikan bahwa seluruh seri sudah berubah menjadi **cara berpikir engineering**.

Seseorang bisa saja hafal:

- cara membuat BPMN model,
- cara membuat Java worker,
- cara deploy Camunda 8,
- cara melihat Operate,
- cara publish message,
- cara membuat timer,
- cara memigrasikan proses,
- cara membuka incident.

Tetapi itu belum cukup untuk level senior/staff/top-tier engineer.

Engineer yang benar-benar kuat harus bisa menjawab pertanyaan seperti:

1. Apa invariant sistem ini?
2. Di mana source of truth berada?
3. Apa yang terjadi ketika command berhasil tetapi client timeout?
4. Apa yang terjadi ketika external API sukses tetapi worker crash sebelum complete job?
5. Apa yang terjadi ketika Operate belum menampilkan state terbaru?
6. Apa yang terjadi ketika process model baru sudah deploy tetapi worker lama masih running?
7. Apa yang terjadi ketika message correlation key salah?
8. Apa yang terjadi ketika incident diselesaikan manual tanpa memperbaiki root cause?
9. Apa yang terjadi ketika payload variable terlalu besar?
10. Apa yang terjadi ketika proses regulatory harus dibuktikan 5 tahun kemudian?

Camunda 8/Zeebe adalah orchestration platform. Tetapi production value-nya tidak datang hanya dari platform. Production value datang dari **cara kita membatasi, mengamankan, mengobservasi, menguji, dan mengoperasikan workflow sebagai distributed system**.

---

## 1. Final Mental Model: Camunda 8 Dalam Satu Kalimat

Camunda 8 adalah platform orchestration terdistribusi yang menjaga state proses jangka panjang, mengeksekusi BPMN sebagai state machine durable, dan menyerahkan side effect bisnis kepada worker eksternal yang harus dirancang idempotent, observable, versioned, dan operationally safe.

Kalimat itu padat. Kita pecah:

| Frasa | Makna Engineering |
|---|---|
| platform orchestration terdistribusi | bukan library embedded biasa; ada broker, gateway, partition, exporter, projection, identity, dan runtime topology |
| state proses jangka panjang | proses dapat hidup menit, jam, bulan, atau tahun |
| BPMN sebagai state machine durable | BPMN bukan gambar dokumentasi; ia adalah executable contract |
| side effect bisnis kepada worker eksternal | broker tidak menjalankan business code Java; Java app mengambil job |
| idempotent | duplicate execution harus aman |
| observable | incident/debugging harus mungkin dilakukan tanpa menebak-nebak |
| versioned | BPMN, worker, variable, form, message, dan decision contract harus evolvable |
| operationally safe | manual repair, retry, cancel, migrate, dan modify harus punya governance |

Jika hanya satu prinsip yang harus dibawa setelah seri ini:

> Zeebe menjaga orchestration state; Java worker menjaga correctness of side effects.

Jika dua prinsip:

> Operate/Tasklist/Optimize adalah read-side projection, bukan sumber kebenaran command path.  
> External side effect harus dianggap unknown sampai dibuktikan oleh ledger/reconciliation, bukan oleh asumsi response timeout.

---

## 2. Mastery Map

Untuk benar-benar mahir, kemampuan Camunda 8 perlu dilihat sebagai kombinasi dari beberapa lapisan.

```text
┌────────────────────────────────────────────────────────────────────┐
│                         Business / Domain                          │
│  case lifecycle, SLA, decision, appeal, enforcement, audit need      │
└───────────────────────────────┬────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────┐
│                     BPMN Orchestration Model                        │
│  wait states, timers, messages, user tasks, call activity, errors    │
└───────────────────────────────┬────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────┐
│                         Zeebe Runtime                               │
│  broker, partition, stream processor, state, gateway, exporter       │
└───────────────────────────────┬────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────┐
│                       Java Worker Layer                             │
│  idempotency, retries, timeout, transaction, side-effect ledger       │
└───────────────────────────────┬────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────┐
│                  Read Model / Operations Layer                      │
│  Operate, Tasklist, Optimize, audit projection, dashboards           │
└───────────────────────────────┬────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────┐
│                    Platform / Runtime Operations                    │
│  Kubernetes, Helm, storage, backup, restore, DR, metrics, security   │
└────────────────────────────────────────────────────────────────────┘
```

Top-tier engineer tidak mempelajari layer ini secara terpisah. Ia membaca konsekuensi lintas-layer.

Contoh:

- keputusan variable payload memengaruhi broker performance, exporter lag, Operate usability, Optimize analytics, PII risk, dan audit retention.
- keputusan retry worker memengaruhi external API rate limit, incident count, SLA, cost, dan duplicate side effect.
- keputusan BPMN granularity memengaruhi readability, worker contract, versioning, debugging, and support workload.
- keputusan cluster partition memengaruhi ordering, scalability, capacity planning, backup/restore, dan hot partition risk.

---

## 3. The 12 Core Invariants of Camunda 8 Engineering

Invariant adalah aturan yang harus tetap benar walaupun sistem mengalami retry, timeout, crash, deploy ulang, lag, operator intervention, atau migration.

### 3.1 Invariant 1 — Process Instance State Belongs to Zeebe

State eksekusi proses berada di Zeebe.

Artinya:

- jangan jadikan database aplikasi sebagai shadow process engine;
- jangan buat domain status yang tidak bisa direkonsiliasi dengan process state;
- jangan menganggap UI task list sebagai final state;
- jangan membuat worker mengubah state proses secara implisit tanpa command ke Zeebe.

Tetapi ini bukan berarti semua business state harus berada di Zeebe variables.

Prinsip yang benar:

```text
Zeebe stores orchestration state.
Domain database stores business state.
Audit projection stores explanatory/read-optimized timeline.
```

### 3.2 Invariant 2 — Business Data Tidak Sama Dengan Process Variables

Process variables adalah contract orchestration.

Business database adalah system of record domain.

Variables sebaiknya berisi:

- identifiers,
- decision result,
- small routing attributes,
- correlation keys,
- milestone data,
- stable summary needed by BPMN.

Variables sebaiknya tidak berisi:

- full document binary,
- huge JSON snapshots,
- sensitive PII tanpa alasan kuat,
- transient technical response body,
- duplicate entire domain aggregate.

### 3.3 Invariant 3 — Worker Execution Is At-Least-Once

Worker dapat menerima job yang sama lebih dari sekali dalam kondisi tertentu.

Penyebab umum:

- worker crash setelah side effect tetapi sebelum complete job;
- network timeout saat complete job;
- job timeout terlalu pendek;
- retry setelah fail job;
- deployment restart;
- external system timeout tidak jelas outcome-nya.

Maka worker harus:

- idempotent,
- punya deduplication key,
- punya operation ledger,
- aman terhadap retry,
- tidak mengandalkan memory lokal sebagai bukti execution.

### 3.4 Invariant 4 — Timeout Is Not Cancellation

Job timeout berarti lease worker atas job dapat habis. Itu tidak otomatis membatalkan side effect yang sedang berjalan.

Jika worker memanggil external API dan API itu masih memproses setelah worker timeout, side effect bisa tetap terjadi.

Maka:

- timeout harus dipasangkan dengan idempotency/reconciliation;
- jangan mengasumsikan `SocketTimeoutException` berarti external operation gagal;
- jangan mengirim retry non-idempotent tanpa key;
- untuk operasi mahal/irreversible, gunakan operation ledger.

### 3.5 Invariant 5 — Operate/Tasklist/Optimize Are Projections

Operate, Tasklist, dan Optimize bergantung pada exported records/read model.

Mereka sangat penting, tetapi bukan command-path source of truth.

Konsekuensi:

- data bisa lag;
- UI bisa belum menampilkan state terbaru;
- analytics bisa bergantung pada import/projection timing;
- automation decision sebaiknya tidak bergantung pada stale projection jika command correctness kritikal.

### 3.6 Invariant 6 — Messages Need Correlation Discipline

Message correlation key adalah salah satu titik paling rawan.

Salah correlation key bisa menyebabkan:

- message tidak terkorelasi;
- message terkorelasi ke instance salah;
- duplicate process instance;
- stuck callback;
- incident yang sulit dijelaskan.

Correlation key harus:

- deterministic,
- unique dalam boundary yang tepat,
- tidak ambigu lintas tenant/environment,
- tidak berubah selama lifecycle callback,
- tervalidasi di inbound adapter.

### 3.7 Invariant 7 — BPMN Model Is an Executable Contract

BPMN bukan hanya diagram komunikasi.

BPMN menentukan:

- wait state,
- job type,
- error path,
- timer path,
- message dependency,
- variable mapping,
- user task assignment,
- version compatibility.

Maka BPMN perlu direview seperti kode.

### 3.8 Invariant 8 — Process Version and Worker Version Must Be Compatible

Deploy BPMN baru tanpa worker compatible adalah incident waiting to happen.

Deploy worker baru tanpa mempertimbangkan proses lama juga berbahaya.

Setiap release harus menjawab:

- process version mana yang akan create instance baru?
- process version lama masih running berapa lama?
- job type lama masih didukung?
- variable schema lama masih dibaca?
- error code lama masih ditangani?
- form lama masih valid?
- message name/correlation key berubah atau tidak?

### 3.9 Invariant 9 — Incident Is a Business/Operational Signal, Not Just Error

Incident berarti proses berhenti pada titik yang perlu tindakan.

Incident bukan sekadar stack trace.

Incident harus punya:

- owner,
- classification,
- SLA,
- remediation path,
- root cause link,
- audit trail,
- prevention action.

### 3.10 Invariant 10 — Manual Repair Must Be Governed

Operate memungkinkan operator melakukan tindakan seperti retry, resolve, cancel, modify, migrate, atau update variables.

Tindakan ini powerful.

Tanpa governance, manual repair dapat menjadi sumber korupsi proses.

Harus ada:

- siapa boleh melakukan apa;
- kapan boleh dilakukan;
- apa bukti approval-nya;
- apa variable yang boleh diubah;
- apa effect terhadap domain system;
- bagaimana action dicatat.

### 3.11 Invariant 11 — Audit Trail Must Be Designed, Not Assumed

Zeebe record stream, Operate history, Optimize report, log worker, dan domain audit table masing-masing punya tujuan berbeda.

Audit defensible biasanya memerlukan kombinasi:

- process timeline,
- human decision record,
- domain state transition,
- external operation ledger,
- operator intervention log,
- access log,
- evidence/document reference,
- retention policy.

### 3.12 Invariant 12 — Migration Is Product Engineering, Not Library Upgrade

Camunda 7 ke 8 bukan sekadar dependency upgrade.

Yang berubah:

- embedded engine ke remote distributed engine;
- JavaDelegate ke worker;
- relational history ke exported/projection model;
- transaction coupling ke idempotent side-effect model;
- JUEL/engine semantics ke FEEL/Zeebe semantics;
- Cockpit/Tasklist lama ke Operate/Tasklist/Optimize baru;
- deployment/operation topology.

---

## 4. Mastery Checklist by Area

Bagian ini bisa dipakai sebagai checklist pribadi, design review, interview preparation, atau readiness assessment sebelum production.

Skala sederhana:

| Level | Makna |
|---|---|
| 0 | belum paham |
| 1 | tahu istilah |
| 2 | bisa pakai di contoh sederhana |
| 3 | bisa desain production sederhana |
| 4 | bisa troubleshoot incident |
| 5 | bisa mengajar, mereview, dan membuat trade-off kompleks |

Target top-tier minimal: mayoritas area berada di level 4–5.

---

## 5. Architecture Mastery Checklist

### 5.1 Platform Component Understanding

Anda harus bisa menjelaskan:

- apa peran Zeebe Broker;
- apa peran Gateway;
- mengapa Gateway stateless;
- apa itu partition;
- apa itu replication factor;
- apa itu leader/follower;
- apa peran exporter;
- kenapa Operate/Tasklist/Optimize butuh secondary storage;
- apa beda command path dan read/projection path;
- mengapa worker berada di luar broker.

### 5.2 Design Questions

Saat melihat arsitektur Camunda 8, tanyakan:

1. Di mana source of truth process state?
2. Di mana source of truth business state?
3. Di mana audit trail authoritative?
4. Apa yang terjadi jika projection lag?
5. Apa yang terjadi jika worker tidak tersedia?
6. Apa yang terjadi jika broker leader berpindah?
7. Apa yang terjadi jika Elasticsearch/OpenSearch down?
8. Apa yang terjadi jika Identity down?
9. Apa yang terjadi jika Gateway autoscale tapi broker bottleneck?
10. Apa yang terjadi jika partition tertentu hot?

### 5.3 Red Flags

- Semua service task memanggil external API kecil-kecil seperti call graph.
- Worker tidak punya idempotency key.
- Variable menyimpan payload besar.
- Operate dijadikan API keputusan otomatis.
- Tidak ada release matrix antara BPMN dan worker.
- Tidak ada runbook incident.
- Tidak ada backup/restore drill.
- Semua tenant berada di cluster sama tanpa access/data isolation story.

---

## 6. BPMN Modelling Mastery Checklist

### 6.1 Hal yang Harus Bisa Dijelaskan

Anda harus bisa menjelaskan:

- apa itu wait state;
- service task menghasilkan job;
- job type adalah contract;
- timer event berbeda dari job retry;
- BPMN error berbeda dari technical failure;
- incident berbeda dari business rejection;
- message catch event butuh correlation key;
- call activity membawa versioning concern;
- multi-instance membawa concurrency/fan-out risk;
- user task adalah human work contract.

### 6.2 BPMN Design Review Checklist

Untuk setiap BPMN model, review:

```text
[ ] Process id stabil dan meaningful.
[ ] Process versioning strategy jelas.
[ ] Start condition jelas: API create, message start, atau event lain.
[ ] Setiap service task punya job type yang versioned/owned.
[ ] Setiap service task punya variable input/output contract.
[ ] Error boundary digunakan untuk business-handled error, bukan semua exception.
[ ] Retry strategy tidak menyebabkan retry storm.
[ ] Timer merepresentasikan deadline/timeout bisnis yang benar.
[ ] Message correlation key unik dan tenant-safe.
[ ] User task assignment/candidate group bisa diaudit.
[ ] Model readable oleh engineer dan business support.
[ ] Tidak ada technical noise berlebihan di BPMN.
[ ] Tidak ada hidden domain transition yang tidak terlihat di audit.
[ ] Call activity punya compatibility strategy.
[ ] Multi-instance punya limit/concurrency/backpressure consideration.
[ ] Process end state meaningful.
```

### 6.3 Heuristic Granularity

Gunakan service task ketika ada boundary yang memiliki nilai operational:

- external dependency;
- irreversible side effect;
- business milestone;
- human-visible status;
- retry/incident boundary;
- SLA boundary;
- audit boundary.

Jangan gunakan service task hanya karena ada method Java baru.

---

## 7. Java Worker Mastery Checklist

### 7.1 Worker Handler Checklist

Setiap worker handler production-grade sebaiknya punya:

```text
[ ] Explicit job type.
[ ] Explicit variable input DTO.
[ ] Input validation.
[ ] Correlation/process/job identifiers in log context.
[ ] Idempotency key.
[ ] Operation ledger or dedup store for external side effects.
[ ] Timeout strategy.
[ ] Retry classification.
[ ] BPMN error mapping for business-known rejection.
[ ] Fail job mapping for transient/technical failure.
[ ] Incident path for non-retryable technical corruption.
[ ] Output variable DTO.
[ ] No large payload output.
[ ] No secret/PII leakage in logs.
[ ] Metrics: duration, success, failure, retries.
[ ] Graceful shutdown safe behavior.
```

### 7.2 Worker Architecture Checklist

```text
[ ] Worker adapter is thin.
[ ] Domain logic does not depend on Camunda API.
[ ] Variable DTOs are versioned.
[ ] Error taxonomy is centralized.
[ ] Idempotency service is reusable.
[ ] External client has timeout/retry/circuit policy.
[ ] DB transaction boundary is explicit.
[ ] Outbox/inbox exists where needed.
[ ] Worker is horizontally scalable.
[ ] Worker has no required local memory state.
[ ] Worker can be restarted safely.
[ ] Worker supports old process versions while they are active.
```

### 7.3 Worker Failure Reasoning

Untuk setiap worker, Anda harus bisa menjawab:

1. Jika worker crash sebelum external call, apa yang terjadi?
2. Jika worker crash setelah external call sukses tetapi sebelum complete job, apa yang terjadi?
3. Jika external API timeout, bagaimana membedakan gagal vs unknown?
4. Jika complete job timeout, apakah side effect akan diulang?
5. Jika job timeout terlalu pendek, apakah external operation duplicate?
6. Jika retry count habis, siapa owner incident?
7. Jika variable schema salah, apakah worker fail fast?
8. Jika proses lama mengirim payload lama, apakah worker baru masih bisa membaca?
9. Jika worker menerima duplicate job, apakah hasilnya deterministic?
10. Jika operator retry incident, apakah side effect aman?

---

## 8. Idempotency and Side Effect Mastery Checklist

### 8.1 Idempotency Key Selection

Candidate key:

| Key | Cocok Untuk | Risiko |
|---|---|---|
| job key | dedup worker execution spesifik | job baru pada retry tertentu bisa berbeda tergantung semantics |
| process instance key | operasi sekali per instance | tidak cukup untuk multi-operation dalam satu instance |
| business id | external operation domain | harus tenant/environment scoped |
| command id | external API idempotency | harus dipersist dan reusable |
| composed key | production-grade operation | paling aman bila dirancang konsisten |

Biasanya gunakan composed key:

```text
tenantId + processDefinitionId + processInstanceKey + operationName + businessObjectId + operationVersion
```

Untuk external API yang mendukung idempotency key:

```text
Idempotency-Key: <stable-operation-id>
```

### 8.2 Operation Ledger Fields

Minimal:

```text
operation_id
operation_type
tenant_id
process_instance_key
job_type
business_key
request_hash
status
external_reference
attempt_count
first_attempt_at
last_attempt_at
completed_at
failure_code
failure_message
reconciliation_status
created_by
updated_by
```

### 8.3 Unknown Outcome Playbook

Jika external operation timeout:

1. Catat status `UNKNOWN`.
2. Jangan langsung mengirim operasi baru jika non-idempotent.
3. Query external system menggunakan reference/idempotency key jika tersedia.
4. Jika ditemukan sukses, complete job dengan result.
5. Jika ditemukan gagal, fail job atau BPMN error sesuai taxonomy.
6. Jika tidak bisa diketahui, route ke manual reconciliation.

---

## 9. Variable Contract Mastery Checklist

### 9.1 Variable Design Rules

```text
[ ] Variables kecil.
[ ] Variables stabil.
[ ] Variables tidak menyimpan full aggregate besar.
[ ] PII diminimalkan.
[ ] Tidak ada secret/token.
[ ] Date/time format explicit.
[ ] BigDecimal/amount tidak kehilangan precision.
[ ] Enum punya compatibility strategy.
[ ] Null semantics jelas.
[ ] Local/global scope dipilih sengaja.
[ ] Input/output mapping mencegah accidental variable overwrite.
[ ] Variable schema version tersedia jika perlu.
```

### 9.2 Bad Variable Smells

- `applicationPayload` berisi seluruh form 2 MB.
- `userInfo` berisi full PII padahal hanya butuh `userId`.
- `response` menyimpan raw HTTP response.
- `status` dipakai domain dan process sekaligus tanpa definisi.
- `error` berisi stack trace.
- `amount` disimpan sebagai floating point.
- `date` tanpa timezone/format.
- Variable lama berubah nama tanpa compatibility.

### 9.3 Variable Review Question

Untuk setiap variable, tanyakan:

1. Siapa yang menulis?
2. Siapa yang membaca?
3. Apakah perlu global?
4. Apakah perlu bertahan sampai retention selesai?
5. Apakah aman dilihat operator?
6. Apakah aman masuk secondary storage?
7. Apakah aman masuk Optimize/reporting?
8. Apakah nilainya berubah antar version?
9. Apakah ia domain truth atau orchestration hint?
10. Apakah bisa diganti dengan reference id?

---

## 10. Message and Correlation Mastery Checklist

### 10.1 Correlation Key Design

Correlation key harus:

```text
[ ] tenant-aware
[ ] environment-safe
[ ] deterministic
[ ] not based on display label
[ ] not based on mutable field
[ ] scoped to one business conversation
[ ] unique enough to avoid wrong match
[ ] logged at inbound boundary
[ ] validated before publish/correlate
```

### 10.2 Message Failure Cases

Anda harus bisa mendesain untuk:

- message arrives before process waits;
- message arrives after timeout path already taken;
- duplicate message arrives;
- wrong tenant message arrives;
- external callback lacks idempotency;
- message TTL too short;
- message TTL too long;
- message name changed across version;
- correlation key changed after process start;
- process instance cancelled but external callback still arrives.

### 10.3 Design Pattern

Untuk external callback:

```text
External System
   │
   ▼
Inbound Callback API
   │ validate auth + tenant + schema
   │ persist inbound event / dedup
   │ resolve business conversation
   ▼
Message Publisher Adapter
   │ publish message to Camunda
   ▼
Zeebe Process Instance
```

Jangan langsung menjadikan controller HTTP sebagai blind publisher tanpa validation/dedup.

---

## 11. Timer, SLA, and Deadline Mastery Checklist

### 11.1 Timer Design Questions

1. Apakah timer ini technical timeout atau business deadline?
2. Apakah timer harus interrupting atau non-interrupting?
3. Apakah deadline bisa diperpanjang?
4. Siapa yang boleh memperpanjang?
5. Apakah regulatory clock berhenti ketika kasus disuspend?
6. Apakah weekend/holiday dihitung?
7. Apakah timezone jelas?
8. Apakah SLA dihitung dari process start atau milestone tertentu?
9. Apakah escalation menghasilkan task baru, notification, atau enforcement path?
10. Apakah overdue task bisa tetap diselesaikan?

### 11.2 Anti-Pattern

- Timer dipakai sebagai retry mechanism untuk external API yang seharusnya worker retry/backoff.
- Timer date dihitung di FE tanpa server authority.
- SLA disimpan hanya sebagai text, bukan variable/queryable fact.
- Boundary timer interrupting digunakan tanpa memahami cancellation effect.
- Timer start event membuat duplicate process karena no business uniqueness.

---

## 12. User Task and Human Workflow Mastery Checklist

### 12.1 User Task Contract

User task harus menjawab:

```text
[ ] Apa decision yang diminta?
[ ] Siapa boleh melihat?
[ ] Siapa boleh claim?
[ ] Siapa boleh complete?
[ ] Apa form/version yang digunakan?
[ ] Apa required evidence?
[ ] Apa output variables?
[ ] Apa validation boundary?
[ ] Apa due date/follow-up?
[ ] Apa escalation path?
[ ] Apa audit record?
```

### 12.2 Custom Task UI Decision

Tasklist cukup ketika:

- workflow sederhana;
- form sederhana;
- authorization relatif sederhana;
- tidak butuh domain-heavy case screen.

Custom task/case UI lebih cocok ketika:

- case context kompleks;
- evidence/document review banyak;
- domain authorization rumit;
- maker-checker/segregation of duties advanced;
- banyak tab/domain aggregate;
- butuh custom search/work queue;
- UI perlu menggabungkan Camunda task dan domain data.

### 12.3 Human Workflow Failure Cases

- user menyelesaikan task dengan stale data;
- task di-claim orang yang salah;
- candidate group salah mapping;
- task selesai tapi domain update gagal;
- operator mengubah variable tanpa approval;
- due date tidak konsisten dengan statutory deadline;
- form version berubah saat task lama masih aktif.

---

## 13. Security and Compliance Mastery Checklist

### 13.1 Access Boundary

Review access untuk:

- deploy process;
- create process instance;
- publish/correlate message;
- activate/complete job;
- view Operate;
- modify instance;
- resolve incident;
- access Tasklist;
- complete user task;
- view Optimize report;
- manage Identity/Admin;
- access secondary storage;
- access worker secrets;
- access logs/traces.

### 13.2 PII and Secret Rules

Never store these in process variables unless explicitly justified and protected:

- passwords;
- access tokens;
- refresh tokens;
- API keys;
- full identity documents;
- unnecessary personal details;
- raw request/response with sensitive payload;
- internal stack traces containing secrets.

Prefer:

- reference ID;
- masked summary;
- classification flag;
- domain secure store;
- encrypted domain field;
- audit-safe metadata.

### 13.3 Defensibility Question

Untuk regulated workflow, tanyakan:

1. Bisa dibuktikan siapa melakukan apa?
2. Bisa dibuktikan kapan dilakukan?
3. Bisa dibuktikan berdasarkan data/form/evidence versi apa?
4. Bisa dibuktikan sistem external dipanggil atau tidak?
5. Bisa dibuktikan hasil external operation?
6. Bisa dibuktikan operator intervention?
7. Bisa dibuktikan access control saat itu?
8. Bisa dibuktikan kenapa proses mengambil cabang tertentu?
9. Bisa dibuktikan apakah SLA dilanggar?
10. Bisa dibuktikan data tidak dimanipulasi diam-diam?

---

## 14. Observability Mastery Checklist

### 14.1 Required Correlation Fields

Gunakan di logs/metrics/traces sesuai konteks:

```text
trace_id
span_id
tenant_id
process_definition_id
process_instance_key
process_version
job_key
job_type
worker_name
business_key
correlation_key
message_name
user_task_key
operation_id
external_reference
incident_key
```

### 14.2 Dashboard Layers

```text
Platform Dashboard
  - broker health
  - gateway health
  - partition leadership
  - exporter health
  - secondary storage health
  - backpressure

Worker Dashboard
  - activation rate
  - completion rate
  - failure rate
  - latency
  - retry count
  - timeout count
  - active jobs

Process Dashboard
  - started/completed instances
  - active instances
  - incident count
  - stuck milestone
  - timer escalation
  - message wait age

Business Dashboard
  - SLA compliance
  - application throughput
  - approval/rejection rate
  - enforcement aging
  - appeal rate
  - human workload
```

### 14.3 Alert Quality

Bad alert:

```text
CPU > 80%
```

Better alert:

```text
High broker CPU + rising job activation latency + rising backpressure + growing active process backlog.
```

Bad alert:

```text
Incident count > 0
```

Better alert:

```text
New P1 process incident for payment-submission job type in production affecting more than 20 process instances within 10 minutes.
```

---

## 15. Performance Mastery Checklist

### 15.1 Bottleneck Analysis Order

Ketika throughput rendah, jangan langsung tambah worker.

Analisis urutan:

1. Apakah process creation rate tinggi?
2. Apakah partition bottleneck?
3. Apakah gateway saturated?
4. Apakah broker CPU/disk pressure?
5. Apakah exporter lag?
6. Apakah secondary storage slow?
7. Apakah worker activation lambat?
8. Apakah worker concurrency terlalu kecil/besar?
9. Apakah external API bottleneck?
10. Apakah payload terlalu besar?
11. Apakah retry storm terjadi?
12. Apakah incidents menumpuk?

### 15.2 Worker Sizing Heuristic

Untuk I/O-bound worker:

```text
needed_concurrency ≈ target_throughput_per_sec × average_latency_sec
```

Contoh:

```text
Target: 100 jobs/sec
Average external API latency: 250 ms = 0.25 sec
Needed in-flight jobs ≈ 100 × 0.25 = 25
```

Lalu tambahkan headroom dan limit downstream.

Untuk CPU-bound worker, concurrency dibatasi oleh CPU core dan GC behavior.

### 15.3 Payload Heuristic

Jika payload besar:

- broker memproses lebih berat;
- exporter lebih berat;
- secondary storage lebih berat;
- Operate/Tasklist lebih lambat;
- Optimize import/report bisa terganggu;
- backup/restore lebih mahal;
- PII/security risk meningkat.

Gunakan reference-over-payload.

---

## 16. Reliability Mastery Checklist

### 16.1 Failure Scenario Table

| Failure | Pertanyaan Utama | Control |
|---|---|---|
| worker crash | side effect sudah terjadi atau belum? | idempotency + ledger |
| broker leader change | apakah command retry aman? | client retry + idempotency |
| gateway down | apakah client punya failover? | multiple gateway/load balancer |
| exporter lag | apakah support UI stale? | projection lag alert + command-source reasoning |
| secondary storage down | apakah process execution tetap jalan? | understand degraded mode |
| external API timeout | outcome unknown? | reconciliation |
| variable schema bad | incident? | validation + contract test |
| process deploy mismatch | worker missing? | release compatibility matrix |
| backup restore | RPO/RTO terpenuhi? | drill |
| operator manual repair | authorized/audited? | runbook + approval |

### 16.2 Backup/Restore Mastery

Anda harus bisa menjawab:

- komponen apa yang dibackup?
- apakah backup consistent across Zeebe and secondary storage?
- bagaimana restore dilakukan?
- apakah restore pernah diuji?
- berapa RPO/RTO nyata?
- apa dampak restore ke external side effect?
- bagaimana reconciliation setelah restore?

### 16.3 DR Reality

DR bukan hanya cluster bisa menyala di region lain.

DR harus mencakup:

- process state;
- secondary storage/projection;
- domain database;
- worker deployment;
- secrets;
- DNS/ingress;
- identity;
- external integration endpoint;
- operation ledger;
- reconciliation playbook.

---

## 17. Migration Mastery Checklist: Camunda 7 to Camunda 8

### 17.1 Inventory

```text
[ ] BPMN models
[ ] JavaDelegate / DelegateExecution usage
[ ] Execution/task listeners
[ ] External tasks
[ ] Embedded forms
[ ] Task queries
[ ] History queries
[ ] Cockpit plugins/custom ops
[ ] REST API consumers
[ ] Process variables and serialization
[ ] Business key usage
[ ] Authorization model
[ ] Multi-tenancy model
[ ] Incident handling process
[ ] Reporting/analytics dependency
[ ] Long-running instance count
```

### 17.2 Refactoring Map

| Camunda 7 Pattern | Camunda 8 Direction |
|---|---|
| JavaDelegate | job worker |
| engine transaction + DB update | explicit domain transaction + idempotency |
| history query | exported/projection/read model |
| Cockpit operation | Operate/API/governed support tooling |
| Tasklist embedded usage | Camunda Tasklist or custom task UI |
| JUEL expressions | FEEL/model-supported expression style |
| embedded engine authorization | Orchestration Cluster authorization + Identity + domain auth |
| direct engine DB reliance | no direct Zeebe state DB reliance |
| process app inside monolith | orchestration + external worker apps |

### 17.3 Migration Strategy

Best default for serious production:

```text
Finish old instances on Camunda 7.
Start new instances on Camunda 8.
Bridge/report both during transition.
Migrate selected instances only when value > risk.
```

Do not migrate everything just because migration is possible.

---

## 18. Interview-Level Questions and Strong Answer Shape

### 18.1 “How is Camunda 8 different from Camunda 7?”

Weak answer:

> Camunda 8 is newer and cloud-native.

Strong answer:

> Camunda 7 is commonly used as an embedded or shared relational process engine where Java delegates can run inside engine transaction boundaries. Camunda 8 uses Zeebe, a distributed orchestration engine. Process execution state is stored in broker partitions as durable streams, and business execution is externalized to job workers. This changes transaction semantics, history/query model, scaling, failure handling, and migration strategy. In Camunda 8, worker idempotency, message correlation, projection lag, and version compatibility become first-class design concerns.

### 18.2 “Why must Camunda 8 workers be idempotent?”

Strong answer:

> Because job execution is effectively at-least-once. A worker may perform an external side effect and crash before completing the job, or complete the job but lose the response due to network failure. Job timeout also does not cancel external operations. Without idempotency, retries can duplicate payments, notifications, submissions, or regulatory actions. A production worker needs a stable operation id, dedup/ledger, request hash, result replay, and reconciliation for unknown outcomes.

### 18.3 “Is Operate the source of truth?”

Strong answer:

> Operate is an operational read-side view built from exported records. It is essential for support and visibility, but it is not the same as the broker command path. It may lag behind the broker. Automated critical decisions should not assume Operate data is perfectly current. For audit/support, projection lag should be observable and understood.

### 18.4 “How do you design message correlation safely?”

Strong answer:

> I define the business conversation boundary first, then choose a stable tenant-scoped correlation key that cannot change during the wait. The inbound callback is authenticated, validated, deduplicated, and mapped to a known conversation before publishing the message. I avoid using mutable display values. I define TTL intentionally and handle duplicate/late callbacks. For critical integrations, I persist inbound events and publish to Camunda through an adapter/outbox so correlation failures are recoverable.

### 18.5 “How do you handle external API timeout in a worker?”

Strong answer:

> I classify it as unknown outcome unless the API guarantees failure. If the operation is idempotent and has a stable idempotency key, retry may be safe. Otherwise I persist an operation ledger with UNKNOWN status and reconcile by querying the external system using a reference/idempotency key. Only after outcome is known do I complete, fail, throw BPMN error, or route to manual repair.

### 18.6 “How do you deploy a new BPMN version safely?”

Strong answer:

> I treat BPMN, worker code, variable schema, forms, messages, and error codes as one release contract. I check whether existing instances continue on old version, whether old job types are still supported, whether new instances use latest version, whether call activity binding is explicit, and whether rollback means stopping new starts rather than magically downgrading running instances. For breaking changes, I either run side-by-side versions or use process instance migration with a tested migration plan.

### 18.7 “How do you design a regulatory case workflow?”

Strong answer:

> I do not force BPMN to become the case database. I keep case aggregate and evidence in the domain system, while Camunda orchestrates milestone transitions, human decisions, timers, escalations, external checks, and enforcement paths. Variables store identifiers and orchestration facts, not full case payload. Human decisions are captured with actor, timestamp, reason, evidence references, and rule/version context. Manual interventions are governed and audited.

---

## 19. Staff-Level Design Review Template

Use this template before approving any Camunda 8 design.

### 19.1 Context

```text
Process name:
Business owner:
Technical owner:
Criticality:
Expected volume:
Expected process duration:
Tenants:
External systems:
Human roles:
Compliance requirements:
```

### 19.2 Process Model Review

```text
Start events:
End states:
Main happy path:
Known business exceptions:
Technical failure paths:
Timers/deadlines:
Messages/callbacks:
User tasks:
Call activities:
Multi-instance:
Compensation:
```

### 19.3 Contract Review

```text
Job types:
Worker owners:
Input variables:
Output variables:
Schema version:
Message names:
Correlation keys:
Error codes:
Form versions:
```

### 19.4 Reliability Review

```text
Idempotency strategy:
Operation ledger:
Retry policy:
Timeout policy:
Unknown outcome handling:
Reconciliation process:
Incident owner:
Manual repair policy:
```

### 19.5 Security Review

```text
Machine credentials:
Human access:
Tenant isolation:
PII classification:
Secret handling:
Operate access:
Tasklist access:
Optimize access:
Audit log:
Retention:
```

### 19.6 Operations Review

```text
Dashboards:
Alerts:
Runbooks:
Backup/restore:
DR:
Capacity assumptions:
Load test result:
Release plan:
Rollback plan:
```

---

## 20. Production Readiness Checklist

### 20.1 Minimum Before Production

```text
[ ] BPMN model reviewed by business and engineering.
[ ] Worker code tested with happy path, error path, retry path.
[ ] Idempotency implemented for all external side effects.
[ ] Variable schema documented and versioned.
[ ] Message correlation keys documented and tested.
[ ] User task authorization reviewed.
[ ] Incident handling runbook exists.
[ ] Operate support access controlled.
[ ] Logs include process/job/business correlation.
[ ] Metrics dashboard exists.
[ ] Alerts exist for incidents/backlog/worker failure/exporter lag.
[ ] Release compatibility matrix exists.
[ ] Rollback plan exists.
[ ] Backup/restore tested for self-managed.
[ ] Security/PII review done.
[ ] Load test done for expected throughput.
[ ] Manual repair procedure approved.
```

### 20.2 High-Maturity Additions

```text
[ ] Operation ledger for all irreversible side effects.
[ ] Reconciliation jobs for unknown outcomes.
[ ] Custom audit projection for regulated timeline.
[ ] Process version governance board/checklist.
[ ] Automated BPMN linting/model checks.
[ ] Contract tests for variable/message schemas.
[ ] Chaos/failure drills for worker crash and downstream timeout.
[ ] DR drill with post-restore reconciliation.
[ ] Task workload analytics.
[ ] SLA dashboard.
[ ] Process improvement feedback loop.
```

---

## 21. Engineering Heuristics to Remember

### 21.1 Source of Truth Heuristic

```text
If it decides process progress, ask Zeebe.
If it decides business legality, ask domain database.
If it explains what happened, ask audit projection.
If it visualizes what likely happened, ask Operate/Optimize with projection-lag awareness.
```

### 21.2 Worker Heuristic

```text
A worker is not a method call from BPMN.
A worker is a distributed command executor with uncertain delivery, uncertain timeout, and external side effects.
```

### 21.3 Retry Heuristic

```text
Retry only when the operation is safe or made safe.
```

### 21.4 Variable Heuristic

```text
If a variable is large, sensitive, mutable, or domain-authoritative, it probably belongs outside Camunda as a reference.
```

### 21.5 BPMN Heuristic

```text
Model business-significant waits, decisions, deadlines, and failure paths.
Do not model every internal method call.
```

### 21.6 Incident Heuristic

```text
An incident is not the end of a process.
It is a controlled pause demanding ownership, diagnosis, and safe recovery.
```

### 21.7 Migration Heuristic

```text
Migrate behavior, not files.
```

### 21.8 Audit Heuristic

```text
If a regulator asks “why did this happen?”, logs alone are not an answer.
```

---

## 22. What Separates Top 1% Engineers Here

Top 1% engineer tidak hanya tahu fitur.

Ia memiliki beberapa kebiasaan:

### 22.1 Mereka Mendesain Dari Failure, Bukan Happy Path

Happy path biasanya mudah.

Yang sulit:

- duplicate callback;
- worker crash;
- unknown external outcome;
- operator retry;
- process version mismatch;
- stale projection;
- partial migration;
- wrong candidate group;
- late message after timeout;
- DR restore with external side effects already executed.

### 22.2 Mereka Memisahkan State Dengan Jelas

Mereka tidak mencampur:

- orchestration state;
- domain state;
- audit state;
- UI state;
- analytics state;
- integration operation state.

### 22.3 Mereka Menghindari Magical Thinking

Contoh magical thinking:

- “Camunda akan memastikan external API hanya dipanggil sekali.”
- “Timeout berarti gagal.”
- “Operate pasti current.”
- “Rollback process model akan memperbaiki running instances.”
- “Retry saja nanti berhasil.”
- “Variable besar tidak masalah karena JSON.”

Top engineer membongkar asumsi itu.

### 22.4 Mereka Mendesain Untuk Operator

Sistem production bukan hanya untuk developer.

Operator/support perlu tahu:

- apa yang stuck;
- kenapa stuck;
- apakah aman retry;
- siapa owner;
- apa dampak bisnis;
- bagaimana repair;
- apa yang tidak boleh dilakukan.

### 22.5 Mereka Menghubungkan Workflow Dengan Business Outcome

Camunda bukan tujuan akhir.

Tujuannya adalah:

- lifecycle lebih terkendali;
- SLA lebih terlihat;
- proses lebih auditable;
- cross-system coordination lebih reliable;
- human decision lebih governed;
- failure recovery lebih aman.

---

## 23. Final Capstone Exercise

Untuk menguji penguasaan, desain sistem berikut:

> Sebuah platform regulatory application processing. Pemohon submit application. Sistem melakukan external validation. Officer melakukan review. Jika incomplete, applicant diminta melengkapi. Jika valid, supervisor approve/reject. Jika approved, license diterbitkan. Jika rejected, applicant bisa appeal dalam 14 hari. Jika license holder melanggar compliance rule, enforcement case dapat dibuka, officer investigate, supervisor decide sanction, dan case dapat masuk appeal/enforcement escalation. Semua decision harus auditable.

### 23.1 Deliverables yang Harus Anda Buat

1. BPMN high-level process.
2. Worker list dan job type.
3. Variable schema.
4. Message correlation design.
5. User task role matrix.
6. Timer/SLA design.
7. Error taxonomy.
8. Idempotency strategy.
9. Operation ledger schema.
10. Audit timeline model.
11. Observability dashboard.
12. Incident runbook.
13. Release/versioning strategy.
14. Security/PII policy.
15. Migration strategy jika sebelumnya Camunda 7.

### 23.2 Evaluation Questions

- Apa yang terjadi jika validation API timeout?
- Apa yang terjadi jika applicant submit additional document dua kali?
- Apa yang terjadi jika officer complete task saat case sudah reassigned?
- Apa yang terjadi jika appeal deadline jatuh di hari libur?
- Apa yang terjadi jika license issuance API sukses tetapi worker crash?
- Apa yang terjadi jika rejection process version berubah?
- Apa yang terjadi jika Operate belum menampilkan task terbaru?
- Apa yang terjadi jika supervisor role mapping salah?
- Apa yang terjadi jika enforcement sanction harus dibatalkan?
- Apa yang terjadi jika restore backup dilakukan setelah external license already issued?

Jika Anda bisa menjawab semua dengan desain konkret, bukan slogan, Anda sudah masuk level sangat kuat.

---

## 24. Roadmap Lanjutan Setelah Seri Ini

Setelah Camunda 8/Zeebe, materi lanjutan terbaik bukan langsung “fitur Camunda lain”, tetapi memperdalam fondasi yang membuat orchestration engineer menjadi jauh lebih kuat.

### 24.1 Workflow Engine Internals

Topik:

- event-sourced workflow execution;
- durable timers;
- command/event processing;
- deterministic workflow;
- replay;
- partitioned log;
- snapshotting;
- state recovery;
- workflow history compaction.

Tujuan:

- memahami Zeebe/Temporal/Cadence/Conductor/Airflow/Argo dari prinsip, bukan vendor.

### 24.2 Temporal vs Camunda 8 Deep Comparison

Topik:

- code-first vs model-first;
- deterministic replay vs BPMN state machine;
- activity retry;
- signal/query/message;
- human workflow;
- visibility;
- long-running workflows;
- migration and operations;
- Java SDK ergonomics.

Tujuan:

- bisa memilih engine berdasarkan problem, bukan preferensi vendor.

### 24.3 Process Mining and Optimization

Topik:

- event log quality;
- process discovery;
- conformance checking;
- variant analysis;
- bottleneck analysis;
- KPI instrumentation;
- operational feedback loop.

Tujuan:

- mengubah workflow engine dari automation tool menjadi continuous improvement system.

### 24.4 Advanced Case Management Architecture

Topik:

- CMMN concepts;
- adaptive case management;
- case aggregate;
- policy-driven workflow;
- dynamic task generation;
- evidence lifecycle;
- regulatory decision traceability.

Tujuan:

- mengelola proses yang tidak sepenuhnya linear.

### 24.5 Distributed Systems Reliability for Business Workflows

Topik:

- exactly-once myth;
- idempotency;
- transaction outbox;
- inbox;
- saga;
- reconciliation;
- failure injection;
- chaos testing;
- DR and restore correctness.

Tujuan:

- membuat workflow tidak hanya berjalan, tetapi survive failure.

### 24.6 Enterprise Workflow Security and Compliance

Topik:

- workflow authorization;
- ABAC/RBAC;
- maker-checker;
- audit tamper-evidence;
- retention;
- PII minimization;
- legal hold;
- traceability;
- secure operations.

Tujuan:

- membuat workflow defensible untuk regulatory/enterprise context.

---

## 25. Ringkasan Seluruh Seri

Seri ini dimulai dari membangun ulang mental model Camunda 8 sebagai distributed orchestration platform, lalu masuk ke arsitektur Zeebe, partitions, stream processing, BPMN runtime semantics, Java client evolution, Java worker correctness, variable contract, modelling patterns, message correlation, error handling, timers, user tasks, Spring Boot integration, worker architecture, connectors, exporters/read-side projection, Operate, Tasklist, Optimize, Identity/security, deployment, performance, reliability, observability, testing, versioning, migration, saga/compensation, case management, tenancy, compliance, anti-patterns, reference architecture, dan akhirnya mastery checklist.

Jika disederhanakan, inti seri ini adalah:

```text
Camunda 8 is not just BPMN automation.
It is durable business coordination across people, systems, time, and failure.
```

Dan untuk Java engineer:

```text
The hard part is not calling the Camunda API.
The hard part is designing workers, contracts, side effects, retries, versions, operations, and audit so the process remains correct under real production failure.
```

---

## 26. Final Checklist: Apakah Anda Sudah Siap?

Anda siap mengklaim pemahaman advanced jika bisa melakukan ini tanpa bergantung pada template:

```text
[ ] Menjelaskan Camunda 7 vs Camunda 8 secara architectural.
[ ] Mendesain BPMN yang executable, readable, dan operationally safe.
[ ] Mendesain Java worker idempotent.
[ ] Mendesain variable schema yang kecil, aman, dan versioned.
[ ] Mendesain message correlation yang tenant-safe.
[ ] Membedakan BPMN error, job failure, incident, escalation.
[ ] Mendesain SLA/timer dengan business semantics.
[ ] Mendesain human workflow dengan authorization dan audit.
[ ] Menggunakan Spring Boot integration tanpa mencampur domain dengan Camunda API.
[ ] Memilih connector vs Java worker dengan alasan kuat.
[ ] Menjelaskan exporter/read-side projection dan projection lag.
[ ] Melakukan incident triage di Operate.
[ ] Mendesain Tasklist/custom case UI boundary.
[ ] Membaca Optimize/report dengan skeptis dan benar.
[ ] Mendesain Identity/auth/tenancy boundary.
[ ] Mendesain deployment topology self-managed/SaaS.
[ ] Melakukan performance bottleneck analysis.
[ ] Mendesain backup/restore/DR dengan reconciliation.
[ ] Membuat observability process-aware.
[ ] Membuat test strategy BPMN + worker + contract.
[ ] Mengelola process versioning dan rollback.
[ ] Merencanakan migration Camunda 7 ke 8.
[ ] Mendesain saga/compensation.
[ ] Memodelkan regulatory case lifecycle.
[ ] Mendesain security/compliance/audit defensibility.
[ ] Mengenali anti-pattern sebelum menjadi incident.
[ ] Menyatukan semuanya dalam reference architecture.
```

Jika sebagian besar sudah “ya”, Anda bukan lagi sekadar pengguna Camunda. Anda sudah berpikir sebagai **workflow/platform engineer**.

---

## 27. Penutup

Seri ini selesai di bagian ini.

File terakhir ini sengaja dibuat sebagai alat review berulang. Saat Anda membangun sistem Camunda 8 nyata, buka kembali bagian ini dan gunakan sebagai checklist.

Jangan mengukur mastery dari banyaknya API yang dihafal.

Ukur dari kemampuan menjawab:

```text
Apa yang tetap benar ketika sistem gagal?
```

Itulah inti engineering untuk Camunda 8/Zeebe.

---

## 28. Referensi Utama

Referensi yang paling penting untuk menjaga pemahaman tetap sesuai roadmap Camunda 8 modern:

1. Camunda Java Client migration dan evolusi dari Zeebe Java Client ke Camunda Java Client.
2. Zeebe architecture: broker, gateway, job worker, partition.
3. Process instance migration dan versioning process definitions.
4. Self-managed Kubernetes reference architecture.
5. Backup/restore operational guide.
6. Job worker concepts dan exception handling.
7. User task, Tasklist, Operate, Optimize, Identity, authorization, multi-tenancy.

Gunakan dokumentasi resmi Camunda sebagai source of truth karena Camunda 8 berkembang cepat, terutama sejak perubahan 8.8/8.9 terkait client, orchestration cluster, authorization, dan runtime packaging.

---

# Status Seri

**SELESAI.**

Seri `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering` telah selesai dari:

```text
part-000
```

sampai:

```text
part-035
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-034.md">⬅️ Part 034 — End-to-End Reference Architecture: Production-Grade Java Camunda 8 System</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<span></span>
</div>
