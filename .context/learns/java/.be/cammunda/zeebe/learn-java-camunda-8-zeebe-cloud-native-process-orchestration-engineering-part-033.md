# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-033.md

# Part 033 — Anti-Patterns, Design Smells, and Production Failure Case Studies

> Seri: **learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering**  
> Bagian: **033 / 035**  
> Topik: **Anti-Patterns, Design Smells, and Production Failure Case Studies**  
> Fokus: membaca tanda bahaya desain Camunda 8/Zeebe sebelum menjadi incident production.

---

## 0. Tujuan Bagian Ini

Pada bagian-bagian sebelumnya, kita sudah membangun fondasi besar:

- arsitektur Camunda 8 dan Zeebe;
- command path vs read/projection path;
- broker, gateway, partition, exporter;
- worker Java production-grade;
- idempotency, retry, duplicate execution;
- variables dan data contract;
- BPMN execution semantics;
- message correlation;
- error handling;
- timers, SLA, human tasks, Tasklist;
- Spring Boot integration;
- connector vs worker;
- Operate, Optimize, observability;
- deployment, performance, reliability, security;
- migration dari Camunda 7;
- saga dan case management.

Bagian ini berbeda.

Di sini kita tidak menambah fitur baru. Kita melatih kemampuan yang membedakan engineer biasa dan engineer senior/staff/top-tier:

> **Mampu melihat sebuah model/process/worker/configuration dan berkata: “ini mungkin masih jalan di demo, tapi akan pecah di production karena alasan X.”**

Camunda 8/Zeebe sering gagal bukan karena engine-nya tidak mampu, tetapi karena desain sistem di sekelilingnya membawa asumsi yang salah:

- menganggap worker dieksekusi exactly once;
- menganggap timeout berarti remote call batal;
- menganggap Operate adalah source of truth untuk keputusan bisnis;
- menganggap variable process boleh menjadi mini database;
- menganggap retry akan menyelesaikan semua masalah;
- menganggap message correlation key cukup pakai email/order number tanpa uniqueness discipline;
- menganggap BPMN yang terlihat lengkap pasti operationally maintainable;
- menganggap deployment BPMN bisa dipisah dari deployment worker;
- menganggap incident bisa diselesaikan hanya dengan “retry”;
- menganggap Camunda 8 sama dengan Camunda 7 yang hanya diganti API.

Bagian ini adalah “failure-oriented learning”.

---

## 1. Mental Model: Anti-Pattern di Camunda 8 Biasanya Berasal dari Salah Kaprah Boundary

Dalam Camunda 8, boundary yang paling sering disalahpahami adalah:

```text
+-------------------------------------------------------------+
|                    Business Process Model                   |
|  "Apa lifecycle bisnis yang harus terjadi?"                 |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|                  Zeebe Orchestration State                  |
|  Durable, partitioned, log-driven process execution          |
+------------------------------+------------------------------+
                               |
             creates jobs / waits for messages / timers
                               |
                               v
+-------------------------------------------------------------+
|                      Java Job Workers                       |
|  External execution, side effects, API calls, DB writes      |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|                   External Business Systems                 |
|  DB, payment, document store, email, registry, APIs          |
+-------------------------------------------------------------+
```

Kesalahan desain biasanya terjadi saat satu layer dipaksa mengerjakan tanggung jawab layer lain.

Contoh:

| Salah Kaprah | Dampak |
|---|---|
| BPMN dijadikan implementation call graph | Model terlalu granular, sulit dioperasikan, rawan stuck |
| Process variables dijadikan database | Payload besar, privacy risk, migration sulit |
| Worker dianggap bagian dari transaksi engine | Duplicate side effect, unknown outcome, retry unsafe |
| Operate dianggap command decision source | Race condition karena projection lag |
| Retry dianggap business recovery | Retry storm, duplicate calls, external system overload |
| Connector dipakai untuk logic kompleks | Idempotency/security/error mapping lemah |
| Message correlation key dibuat asal | Salah instance menerima message atau duplicate instance |
| Job type tidak versioned | Worker baru memproses contract lama secara salah |
| Human task dianggap sekadar screen | Audit, authorization, SLA, assignment rusak |
| Camunda 8 dianggap Camunda 7 remote | Migrasi gagal secara arsitektural |

Jadi anti-pattern bukan sekadar “kode jelek”. Anti-pattern adalah **boundary salah** yang kebetulan masih bisa berjalan sampai traffic, failure, concurrency, atau audit datang.

---

## 2. Cara Membaca Design Smell

Sebuah smell bukan bukti pasti sistem salah. Smell adalah sinyal bahwa desain perlu ditanya lebih keras.

Framework membaca smell:

```text
1. Apa assumption tersembunyi?
2. Di kondisi normal, apakah assumption ini terlihat benar?
3. Di kondisi failure, apakah assumption ini tetap benar?
4. Jika tidak, apa blast radius-nya?
5. Apakah sistem bisa mendeteksi masalah?
6. Apakah sistem bisa recover tanpa data corruption?
7. Apakah operator bisa menjelaskan apa yang terjadi?
8. Apakah auditor/user bisa menerima hasilnya?
```

Contoh:

```text
Smell:
"Worker mengirim email lalu complete job."

Pertanyaan:
- Kalau email sukses tapi complete job timeout?
- Kalau job di-retry, apakah email terkirim dua kali?
- Apakah ada idempotency key ke email provider?
- Apakah email harus exactly once atau at-least-once acceptable?
- Apakah ada operation ledger?
- Apakah audit bisa menunjukkan email pertama sudah terkirim?
```

Engineer biasa melihat happy path.

Engineer production melihat **unknown outcome path**.

---

## 3. Anti-Pattern #1 — BPMN as Microservice Call Graph

### 3.1 Bentuk Anti-Pattern

Model BPMN dibuat seperti ini:

```text
Receive Request
 -> Call User Service
 -> Call Account Service
 -> Call Address Service
 -> Call Risk Service
 -> Call Document Service
 -> Call Notification Service
 -> Call Audit Service
 -> Call Report Service
 -> End
```

Setiap method/API menjadi service task.

### 3.2 Kenapa Ini Terlihat Menarik

Karena secara visual terlihat “lengkap”:

- semua call terlihat;
- mudah dijelaskan saat demo;
- setiap integration point tampak eksplisit;
- terlihat seperti observability bawaan.

Tetapi ini sering salah.

### 3.3 Masalah Utama

BPMN bukan sequence diagram low-level.

Zeebe cocok untuk mengorkestrasi **business-relevant progress**, bukan setiap HTTP call internal.

Jika satu business operation membutuhkan 8 call internal yang harus atomik secara domain, sering lebih baik dibuat satu worker/domain service:

```text
BPMN:
Perform Eligibility Assessment

Worker:
- load applicant
- validate account
- check address
- query risk
- persist assessment result
- produce audit event
```

Bukan:

```text
BPMN:
Load Applicant -> Validate Account -> Check Address -> Query Risk -> Persist Result -> Audit
```

### 3.4 Dampak Production

| Dampak | Penjelasan |
|---|---|
| Process terlalu noisy | Operate penuh node teknis yang tidak meaningful bagi support bisnis |
| Failure surface melebar | Setiap call kecil menjadi incident kandidat |
| Versioning sulit | Perubahan internal service memaksa perubahan BPMN |
| SLA misleading | Waktu proses terpecah ke node teknis yang bukan milestone |
| Retry tidak kontekstual | Retry per call bisa merusak consistency domain |
| Model tidak stabil | BPMN berubah tiap refactor code |

### 3.5 Rule of Thumb

Gunakan service task jika aktivitas tersebut:

- punya arti bisnis;
- punya boundary failure yang berbeda;
- perlu visible di Operate;
- bisa diretry/di-repair secara mandiri;
- punya SLA atau audit value;
- mungkin dikerjakan sistem/human berbeda;
- merupakan milestone lifecycle.

Jangan gunakan service task hanya karena “ada method”.

### 3.6 Refactoring

Dari:

```text
Validate NIK
 -> Validate Address
 -> Validate License
 -> Validate Tax
 -> Validate Attachment
```

Menjadi:

```text
Perform Pre-Assessment Validation
```

Dengan output:

```json
{
  "validationStatus": "FAILED",
  "validationFindings": [
    { "code": "ADDRESS_NOT_MATCHED", "severity": "WARNING" },
    { "code": "ATTACHMENT_MISSING", "severity": "BLOCKER" }
  ]
}
```

Jika beberapa validation memang punya lifecycle berbeda, baru pecah.

---

## 4. Anti-Pattern #2 — One Giant BPMN That Models Everything

### 4.1 Bentuk Anti-Pattern

Satu model BPMN mencakup:

- intake;
- verification;
- review;
- approval;
- payment;
- appeal;
- enforcement;
- renewal;
- cancellation;
- reporting;
- notification;
- archival;
- exception handling;
- admin override.

Hasilnya: satu diagram raksasa.

### 4.2 Kenapa Ini Bahaya

BPMN besar sering memberi ilusi bahwa semua lifecycle “terkendali”. Padahal:

- tidak ada modular boundary;
- change impact besar;
- review sulit;
- incident diagnosis lambat;
- process version migration sulit;
- audit narrative kabur;
- testing scenario meledak.

### 4.3 Smell

Jika diagram butuh zoom out ekstrem dan tidak bisa dijelaskan dalam 5–10 milestone utama, kemungkinan model terlalu besar.

### 4.4 Refactoring Pattern

Gunakan:

- call activity;
- reusable subprocess;
- separate process per lifecycle phase;
- case aggregate sebagai source of business lifecycle;
- event/message untuk transisi antar phase;
- process registry/domain table untuk tracking.

Contoh:

```text
Application Intake Process
Application Assessment Process
Application Approval Process
Appeal Process
Enforcement Process
Renewal Process
```

Bukan satu “Mega Application Lifecycle Process”.

### 4.5 Prinsip

> Camunda process sebaiknya menjadi executable lifecycle slice, bukan seluruh enterprise domain map.

---

## 5. Anti-Pattern #3 — Process Variables as Database

### 5.1 Bentuk Anti-Pattern

Process variables menyimpan:

- full applicant profile;
- full document metadata;
- attachment base64;
- large JSON response dari external API;
- entire request/response history;
- audit log;
- user permission snapshot besar;
- generated PDF content;
- raw email HTML;
- full case record.

### 5.2 Kenapa Ini Salah

Camunda 8 process variables adalah context untuk orchestration, bukan database domain. Dokumentasi Camunda menekankan penggunaan variables secara lightweight dan meaningful, serta menyebut payload process instance memiliki limit 4 MB termasuk internal engine data.

### 5.3 Dampak

| Masalah | Dampak |
|---|---|
| Payload besar | Command latency naik |
| Exporter pressure | Projection lambat |
| Operate berat | Variable inspection lambat |
| PII exposure | Data sensitif tersebar |
| Migration sulit | Schema lama menempel di running instance |
| Incident sulit | Variable corrupted/besar memblokir progress |
| Storage cost naik | Secondary storage membengkak |
| Audit salah tempat | Audit tidak searchable/governed dengan baik |

### 5.4 Pattern yang Benar

Gunakan **reference-over-payload**.

```json
{
  "caseId": "CASE-2026-0000123",
  "applicantId": "APP-123",
  "assessmentId": "ASM-987",
  "documentBundleId": "DOCB-456",
  "decisionId": "DEC-111",
  "phase": "ASSESSMENT",
  "riskLevel": "HIGH"
}
```

Detail domain tinggal di domain database/document store.

### 5.5 Kapan Variable Boleh Detail?

Variable boleh detail jika:

- kecil;
- relevan untuk routing;
- relevan untuk human decision screen;
- relevan untuk BPMN condition;
- tidak sensitif atau sudah dimasking;
- stabil secara schema;
- diperlukan untuk audit process-level.

### 5.6 Smell Checklist

Tanyakan:

```text
Apakah variable ini digunakan gateway?
Apakah variable ini diperlukan worker berikutnya?
Apakah variable ini diperlukan Tasklist/Form?
Apakah variable ini aman terlihat di Operate?
Apakah variable ini akan tetap valid 2 tahun lagi?
Apakah variable ini lebih cocok menjadi reference id?
```

Jika jawabannya banyak “tidak”, jangan masukkan ke process variable.

---

## 6. Anti-Pattern #4 — Non-Idempotent Worker

### 6.1 Bentuk Anti-Pattern

Worker seperti ini:

```java
@JobWorker(type = "send-email")
public void handle(JobClient client, ActivatedJob job) {
    emailService.send(to, subject, body);
    client.newCompleteCommand(job.getKey()).send().join();
}
```

Terlihat normal. Tetapi berbahaya.

### 6.2 Masalah Fundamental

Camunda worker harus didesain dengan mental model **at-least-once execution**.

Job bisa dieksekusi ulang karena:

- worker crash setelah side effect;
- complete command timeout;
- gateway/broker/network issue;
- job timeout;
- retry manual;
- incident resolved;
- deployment rolling restart;
- worker app autoscaling;
- handler exception setelah external side effect.

### 6.3 Failure Case

```text
T0 worker activates job
T1 worker sends email successfully
T2 worker sends complete job command
T3 network timeout, worker does not know result
T4 job becomes available/retried
T5 another worker sends same email again
```

Engine tidak bisa tahu email sudah terkirim jika worker tidak mencatatnya secara idempotent.

### 6.4 Correct Pattern

Gunakan operation ledger/idempotency store:

```text
operation_key = processInstanceKey + ":" + elementId + ":" + businessOperation
```

Atau untuk business operation:

```text
operation_key = "SEND_DECISION_EMAIL:" + decisionId
```

Pseudo-flow:

```text
1. Compute idempotency key
2. Try register operation as STARTED
3. If already COMPLETED, replay result and complete job
4. If STARTED but stale, reconcile
5. Execute side effect with idempotency key if provider supports it
6. Persist external reference and mark COMPLETED
7. Complete Zeebe job
```

### 6.5 Worker Correctness Rule

> Every worker that touches the outside world must be safe under duplicate execution.

Tidak semua duplicate harus dicegah di Camunda. Yang penting adalah side effect-nya aman.

---

## 7. Anti-Pattern #5 — “Complete Job Then Do Side Effect”

### 7.1 Bentuk Anti-Pattern

```java
client.newCompleteCommand(job.getKey()).send().join();
paymentGateway.charge(...);
```

Motivasinya: “Biar job tidak retry kalau external call lambat.”

Ini salah besar.

### 7.2 Dampak

Jika job sudah completed, process lanjut. Jika side effect gagal setelah itu:

- process state mengatakan task sukses;
- external world belum berubah;
- Operate tidak menunjukkan incident;
- downstream step berjalan dengan asumsi palsu;
- audit menjadi tidak defensible.

### 7.3 Kapan Boleh Complete Duluan?

Hampir tidak boleh untuk side effect yang merupakan esensi service task.

Complete boleh dilakukan setelah worker berhasil memenuhi contract service task.

Jika ingin async, modelkan sebagai async pattern:

```text
Start External Operation
 -> Wait For Callback Message
```

Atau:

```text
Submit Payment Request
 -> Wait Payment Confirmed / Payment Failed
```

### 7.4 Correct Architecture

```text
Service Task: Submit Payment Request
Worker:
  - writes operation ledger
  - sends request to payment provider
  - stores provider transaction id
  - completes job

BPMN:
  - waits for payment callback message
  - timer boundary handles no callback
```

Complete job berarti “request submitted”, bukan “payment settled”, jika settlement belum diketahui.

Contract harus jelas.

---

## 8. Anti-Pattern #6 — Infinite / Blind Retry

### 8.1 Bentuk Anti-Pattern

Semua exception dibuat retry:

```java
catch (Exception e) {
    throw e; // framework fails job and retries
}
```

Atau:

```text
retries = 999
```

### 8.2 Kenapa Berbahaya

Retry hanya benar untuk transient failure.

Retry salah untuk:

- invalid variable schema;
- missing mandatory field;
- unauthorized access karena config salah;
- business rejection;
- non-existent external reference;
- deterministic mapping bug;
- incompatible worker version;
- wrong tenant id;
- malformed BPMN expression.

### 8.3 Dampak

| Dampak | Penjelasan |
|---|---|
| Retry storm | External dependency makin overload |
| Incident tertunda | Masalah deterministic baru terlihat setelah banyak retry |
| Cost naik | Worker dan broker membuang resource |
| Audit noise | Banyak failure record tanpa value |
| MTTR naik | Root cause terkubur noise |
| Duplicate side effect | Jika handler tidak idempotent |

### 8.4 Correct Retry Taxonomy

| Error Type | Action |
|---|---|
| Network timeout transient | retry with backoff |
| HTTP 429 | retry with rate-limit/backoff |
| HTTP 503 | retry, bounded |
| HTTP 400 due invalid payload | no retry; BPMN error or incident |
| Business rejection | BPMN error/business path |
| Authorization config error | incident |
| Mapping bug | incident |
| Duplicate request | idempotent replay |
| Unknown outcome | reconcile before retry |

### 8.5 Rule

> Retry is not recovery. Retry is only one recovery tool.

---

## 9. Anti-Pattern #7 — BPMN Error Used for Technical Failure

### 9.1 Bentuk Anti-Pattern

Setiap exception dilempar sebagai BPMN error:

```java
throw new BpmnError("SYSTEM_ERROR", "Database timeout");
```

### 9.2 Kenapa Salah

BPMN error adalah business-level error yang process model memang mengantisipasi.

Technical failure seperti:

- database timeout;
- connection refused;
- downstream 503;
- worker bug;
- config missing;
- serialization issue;

bukan business alternative path. Itu operational failure.

### 9.3 Dampak

Jika technical failure dimodelkan sebagai business path:

- process bisa lanjut ke outcome salah;
- incident tidak muncul;
- operator tidak sadar ada platform issue;
- KPI business tercemar;
- audit misleading.

### 9.4 Correct Mapping

| Condition | Camunda Handling |
|---|---|
| Customer not eligible | BPMN error / business path |
| Payment declined | BPMN error / business path |
| Risk service timeout | job failure + retry |
| Risk service unavailable after retries | incident or escalation |
| Invalid process variable due deployment bug | incident |
| Duplicate callback | idempotent ignore/replay |
| Suspicious fraud result | explicit business path |

### 9.5 Senior Rule

> BPMN error is for expected business alternative, not infrastructure pain.

---

## 10. Anti-Pattern #8 — Job Failure Used for Business Rejection

### 10.1 Bentuk Anti-Pattern

Worker gagal dengan retry ketika applicant tidak eligible:

```java
if (!eligible) {
    client.newFailCommand(job.getKey())
        .retries(3)
        .errorMessage("Applicant not eligible")
        .send();
}
```

### 10.2 Masalah

“Not eligible” bukan technical failure. Itu hasil bisnis valid.

Kalau dimasukkan retry:

- worker akan mengecek ulang hal yang sama;
- incident bisa muncul padahal tidak ada incident teknis;
- SLA support terganggu;
- Operate penuh false incident;
- process tidak masuk path rejection yang benar.

### 10.3 Correct Pattern

Modelkan:

```text
Assess Eligibility
 -> Exclusive Gateway
    -> Eligible
    -> Not Eligible
```

Atau worker throw BPMN error yang ditangkap boundary error:

```text
Assess Eligibility
 --BPMN Error: NOT_ELIGIBLE--> Notify Rejection
```

### 10.4 Rule

> Business outcome should move the process, not break the worker.

---

## 11. Anti-Pattern #9 — Message Correlation Key Without Domain Discipline

### 11.1 Bentuk Anti-Pattern

Message correlation key menggunakan:

- email;
- phone number;
- user name;
- external reference yang tidak unik;
- mutable identifier;
- free-text case number;
- partially formatted id;
- environment-agnostic id;
- tenant-unaware id.

### 11.2 Kenapa Bahaya

Message correlation adalah routing ke process instance. Jika key salah:

- message masuk instance salah;
- duplicate instance terbentuk;
- callback hilang;
- process stuck menunggu message;
- confidential data masuk case salah;
- audit rusak.

### 11.3 Correct Key Design

Correlation key harus:

- stable;
- unique dalam scope message;
- tenant-aware jika multi-tenant;
- environment-safe;
- tidak mutable;
- tidak bergantung formatting UI;
- tidak PII jika bisa dihindari;
- ditentukan sebagai part of integration contract.

Contoh:

```text
tenantId + ":" + externalSystem + ":" + externalOperationId
```

Atau:

```text
REGULATOR_A:CASE-2026-000123:PAYMENT-REQUEST-998877
```

### 11.4 Message ID

Untuk deduplication publishing, gunakan message id jika flow memerlukan duplicate prevention.

Jangan menganggap correlation key dan message id adalah hal yang sama:

```text
correlationKey = "case/payment id untuk routing"
messageId      = "unique id untuk publish deduplication"
```

### 11.5 Smell

Jika tim tidak bisa menjawab:

```text
Apa uniqueness scope correlation key ini?
Berapa lama key ini valid?
Apakah key ini tenant-aware?
Apakah key ini berubah kalau user update profile?
Apa yang terjadi jika callback datang dua kali?
Apa yang terjadi jika callback datang sebelum process menunggu?
```

Maka message design belum production-ready.

---

## 12. Anti-Pattern #10 — Treating Operate as Source of Truth for Business Decisions

### 12.1 Bentuk Anti-Pattern

Aplikasi domain melakukan query ke Operate untuk memutuskan:

```text
"Apakah case ini sudah approved?"
"Apakah task ini sudah selesai?"
"Apakah boleh submit appeal?"
"Apakah payment step sudah lewat?"
```

### 12.2 Masalah

Operate adalah operational read/projection surface, bukan transactional business source of truth.

Projection bisa lag. Exporter bisa tertunda. Secondary storage bisa punya delay. Operate sangat berguna untuk support, tetapi jangan jadikan dependency sinkron untuk business command.

### 12.3 Dampak

```text
T0 Zeebe process completed approval step
T1 Exporter lag 3 seconds
T2 Domain app query Operate: approval belum terlihat
T3 App menolak action user
```

Atau sebaliknya:

```text
Operate masih menunjukkan state lama
Domain app mengambil keputusan berdasarkan projection stale
```

### 12.4 Correct Pattern

Business command decision harus berdasarkan:

- domain database;
- explicit event/operation ledger;
- process-owned command result;
- dedicated read model dengan consistency expectation jelas;
- message/event from process to domain service.

Gunakan Operate untuk:

- support;
- triage;
- incident;
- operator intervention;
- visual debugging;
- manual repair;
- technical process investigation.

### 12.5 Rule

> Projection is for observation. Command-side decisions need explicit consistency design.

---

## 13. Anti-Pattern #11 — No Versioned Contract Between BPMN and Worker

### 13.1 Bentuk Anti-Pattern

BPMN service task:

```text
type = "assess-risk"
```

Worker lama dan baru sama-sama consume `assess-risk`, tetapi variable schema berubah.

Versi lama expect:

```json
{
  "applicantId": "A-1",
  "income": 10000000
}
```

Versi baru expect:

```json
{
  "party": {
    "id": "A-1",
    "declaredIncome": 10000000
  }
}
```

### 13.2 Failure

Running instance dari process lama membuat job dengan schema lama. Worker baru membaca schema baru. Hasil:

- NullPointerException;
- wrong decision;
- incident;
- silent data corruption;
- bad audit.

### 13.3 Correct Strategies

Ada beberapa strategi.

#### Strategy A — Versioned Job Type

```text
assess-risk.v1
assess-risk.v2
```

Kelebihan: boundary jelas.  
Kekurangan: job type bertambah.

#### Strategy B — Stable Envelope

```json
{
  "contractVersion": 2,
  "payload": {
    ...
  }
}
```

Worker support multiple versions.

#### Strategy C — Adapter Layer

Worker menerima old/new schema lalu normalize ke domain command.

#### Strategy D — Deploy Worker Backward Compatible Before BPMN

Order:

```text
1. Deploy worker that supports v1 and v2
2. Deploy BPMN that emits v2
3. Drain v1 instances
4. Remove v1 support
```

### 13.4 Rule

> BPMN model and worker code are one release contract, even if deployed separately.

---

## 14. Anti-Pattern #12 — Using Connectors for Complex Business Logic

### 14.1 Bentuk Anti-Pattern

Connector dipakai untuk:

- complex validation;
- multi-step idempotency;
- transactional writes;
- conditional retry by domain state;
- external operation reconciliation;
- business audit;
- security policy evaluation;
- rate-limited high-volume integration.

### 14.2 Kenapa Terlihat Menarik

Connector cepat:

- low-code;
- mudah dipasang di Modeler;
- tidak perlu deploy worker;
- cocok untuk HTTP/email/simple integration.

### 14.3 Masalah

Untuk logic kompleks, connector bisa menyembunyikan complexity yang seharusnya eksplisit di Java code:

- sulit unit test;
- sulit idempotency;
- sulit transaction boundary;
- sulit domain validation;
- sulit custom observability;
- sulit secret/access governance;
- sulit rollback.

### 14.4 Decision Rule

Gunakan connector untuk:

```text
simple, stateless, low-risk integration
```

Gunakan Java worker untuk:

```text
stateful, idempotent, regulated, high-risk, high-volume, or domain-heavy integration
```

### 14.5 Hybrid Pattern

```text
BPMN -> Java Worker -> Integration Gateway -> External API
```

Connector boleh tetap dipakai untuk edge notification/non-critical integration jika governance jelas.

---

## 15. Anti-Pattern #13 — Hidden Synchronous Long Call in Worker

### 15.1 Bentuk Anti-Pattern

Worker menunggu external operation panjang:

```text
Generate report: 5 minutes
Screening batch: 20 minutes
Payment settlement: 2 hours
Manual external review: 3 days
```

Worker tetap hold job sampai selesai.

### 15.2 Masalah

Job worker cocok untuk work unit yang bisa selesai dalam timeout realistis.

Jika external operation lama:

- job timeout;
- duplicate execution;
- worker thread blocked;
- scaling buruk;
- retry ambiguous;
- incident false positive;
- external operation sulit direconcile.

### 15.3 Correct Pattern

Split menjadi:

```text
Submit External Request
 -> Wait for Callback Message
 -> Continue
```

Dengan boundary timer:

```text
Wait for Callback
 --timer--> Escalate / Query Status / Manual Review
```

### 15.4 Worker Contract

Worker untuk `submit-external-request` hanya bertanggung jawab:

- create external operation;
- persist external operation id;
- complete job.

Bukan menunggu operation selesai jika completion asynchronous.

---

## 16. Anti-Pattern #14 — Timer Abuse

### 16.1 Bentuk Anti-Pattern

Timer dipakai untuk:

- polling setiap beberapa detik;
- mengganti message callback;
- load scheduling massal;
- retry external API;
- menunggu eventual consistency tanpa batas;
- business calendar yang kompleks tanpa domain service.

### 16.2 Masalah

Timer adalah process construct, bukan generic scheduler untuk semua hal.

Timer yang terlalu banyak bisa:

- membuat process noisy;
- meningkatkan jumlah pending events;
- sulit di-debug;
- membuat SLA tidak jelas;
- mencampur technical polling dengan business waiting;
- memperburuk incident triage.

### 16.3 Correct Pattern

| Kebutuhan | Pattern |
|---|---|
| Tunggu callback bisnis | message catch event |
| Deadline bisnis | timer boundary/event |
| Polling technical frequent | external scheduler/worker/domain service |
| Retry transient API | job retry/backoff |
| Calendar calculation | deadline service |
| Long timeout no callback | timer escalation |

### 16.4 Rule

> Use BPMN timers for business time, not as replacement for every scheduler.

---

## 17. Anti-Pattern #15 — No Explicit Unknown Outcome Handling

### 17.1 Bentuk Anti-Pattern

Worker melakukan external call:

```text
POST /payments
timeout after 5 seconds
retry
```

Tanpa tahu apakah request pertama sukses di provider.

### 17.2 Unknown Outcome

Timeout tidak berarti gagal.

Kemungkinan:

```text
- request tidak sampai
- request sampai tapi response hilang
- provider memproses lambat
- provider sukses tapi callback terlambat
- provider membuat duplicate transaction on retry
```

### 17.3 Correct Handling

Gunakan:

- external idempotency key;
- client-generated operation id;
- operation ledger;
- query/reconcile endpoint;
- callback message;
- manual review if ambiguous.

### 17.4 Pattern

```text
1. Generate operationId
2. Persist operation STARTED
3. Send request with operationId/idempotency key
4. If timeout:
   - do not blindly retry unsafe operation
   - query by operationId
   - if found SUCCESS, mark completed
   - if found FAILED, route failure
   - if unknown after threshold, incident/manual review
```

### 17.5 Rule

> A timeout is an observation failure, not a business failure.

---

## 18. Anti-Pattern #16 — Process Model Hides Domain State Machine

### 18.1 Bentuk Anti-Pattern

Tim menganggap process instance adalah satu-satunya state case.

Tidak ada domain case status. Semua status ditentukan dari BPMN current activity.

### 18.2 Masalah

BPMN activity state tidak selalu cukup sebagai domain state:

- multiple tokens;
- parallel tasks;
- event subprocess;
- waiting states;
- projection lag;
- process modification;
- migration;
- manual correction;
- human task assignment;
- case reopened;
- external domain events.

### 18.3 Correct Pattern

Gunakan domain aggregate:

```text
Case
- caseId
- phase
- status
- assignedUnit
- riskLevel
- deadline
- regulatoryFlags
- currentProcessInstanceKey
```

Process mengorkestrasi transitions. Domain tetap menyimpan state bisnis yang dibutuhkan aplikasi.

### 18.4 Relationship

```text
BPMN process = executable orchestration
Domain state machine = business truth for application behavior
Audit trail = explainability/history
```

### 18.5 Rule

> Do not force BPMN runtime state to be your entire domain model.

---

## 19. Anti-Pattern #17 — Human Task Without Authorization Model

### 19.1 Bentuk Anti-Pattern

Task assignment hanya berdasarkan candidate group:

```text
candidateGroups = "officer"
```

Aplikasi menganggap siapa pun di group boleh melihat/mengerjakan semua task.

### 19.2 Masalah

Di regulated workflow, authorization biasanya lebih kompleks:

- agency;
- department;
- role;
- case sensitivity;
- conflict of interest;
- maker-checker;
- prior action;
- delegation;
- leave substitution;
- region;
- value threshold;
- special handling flag.

### 19.3 Correct Pattern

Pisahkan:

```text
Task visibility = who may see task
Task claimability = who may claim
Task action permission = who may perform decision
Task data permission = what fields/documents can be seen
Task audit = who did what and why
```

Tasklist/Identity mungkin cukup untuk basic work management, tetapi custom case/task UI sering perlu domain authorization layer.

### 19.4 Rule

> Assignment is not authorization. Candidate group is not full access control.

---

## 20. Anti-Pattern #18 — Incident Resolved by “Just Retry”

### 20.1 Bentuk Anti-Pattern

Operator melihat incident dan klik retry tanpa root cause.

### 20.2 Kenapa Berbahaya

Retry bisa:

- mengulang side effect;
- menambah pressure;
- menyembunyikan bug deterministic;
- membuat data makin corrupt;
- memperpanjang outage;
- memperumit audit.

### 20.3 Correct Incident Triage

Sebelum retry:

```text
1. What failed?
2. Was side effect executed?
3. Is retry idempotent?
4. Has dependency recovered?
5. Is variable data valid?
6. Is worker version compatible?
7. Is there a known duplicate risk?
8. Do we need variable repair?
9. Do we need process modification?
10. Do we need manual reconciliation?
```

### 20.4 Incident Categories

| Category | Retry? |
|---|---|
| External transient recovered | yes, if idempotent |
| Invalid variable | repair then retry |
| Code bug | deploy fix then retry |
| Duplicate operation unknown | reconcile first |
| Business rejection misclassified | route/modify process |
| Missing worker | deploy worker then retry |
| Authorization config wrong | fix config then retry |
| Payload too large | redesign/repair |

### 20.5 Rule

> Retry is an operational command. Treat it like a production write action.

---

## 21. Anti-Pattern #19 — No Worker Ownership Model

### 21.1 Bentuk Anti-Pattern

Process has service tasks:

```text
send-notification
assess-risk
generate-document
sync-registry
```

Tetapi tidak jelas:

- siapa owner worker;
- siapa on-call;
- siapa maintain contract;
- siapa handle incident;
- siapa approve BPMN changes;
- siapa owns external API relationship.

### 21.2 Dampak

Incident terjadi:

```text
Operate: job failed in "sync-registry"
Team A: itu BPMN team
Team B: itu API team
Team C: itu infra
Team D: itu vendor
```

MTTR tinggi karena ownership kabur.

### 21.3 Correct Ownership Matrix

Setiap job type harus punya:

```text
jobType
contract owner
runtime owner
business owner
on-call group
external dependency
retry policy
incident policy
dashboard
runbook
SLO
```

Contoh:

| Job Type | Runtime Owner | Business Owner | Runbook | Criticality |
|---|---|---|---|---|
| `assessment.perform.v2` | Assessment Service Team | Licensing Ops | RUN-ASSESS-002 | High |
| `notification.email.v1` | Platform Integration | Customer Ops | RUN-NOTIF-001 | Medium |
| `registry.sync.v3` | Integration Team | Compliance Ops | RUN-REG-003 | High |

### 21.4 Rule

> A job type without an owner is an incident waiting to be orphaned.

---

## 22. Anti-Pattern #20 — Environment-Unsafe Correlation and Message Publishing

### 22.1 Bentuk Anti-Pattern

External system publishes callback to generic endpoint:

```text
/callback/payment
```

Payload:

```json
{
  "paymentId": "P-123"
}
```

No tenant. No environment. No process mapping. No signature. No idempotency.

### 22.2 Failure Modes

- UAT callback hits PROD endpoint;
- tenant A callback correlated to tenant B;
- duplicate callback completes wrong process;
- malicious replay;
- callback arrives before process subscribes;
- callback after process cancelled;
- stale payment id reused.

### 22.3 Correct Design

Callback endpoint should validate:

- environment;
- tenant;
- signature;
- timestamp;
- replay window;
- event id;
- operation id;
- current domain state;
- expected process subscription;
- idempotency.

### 22.4 Pattern

```text
External callback
 -> API gateway/security validation
 -> callback handler
 -> domain operation lookup
 -> idempotency check
 -> publish Camunda message with correlationKey and messageId
```

Do not let external payload directly decide process correlation without domain validation.

---

## 23. Anti-Pattern #21 — Over-Trusting BPMN Visual Readability

### 23.1 Bentuk Anti-Pattern

Model looks clean:

```text
Submit -> Review -> Approve -> Notify
```

But hidden inside workers:

- review step updates 15 tables;
- approve step calls 5 external APIs;
- notify step sends email/SMS/push/report;
- error handling hidden in code;
- retry policy unknown;
- variables overwritten silently.

### 23.2 Masalah

BPMN yang readable tidak selalu operationally transparent.

### 23.3 What Good Readability Means

A readable Camunda 8 process is not merely pretty. It should reveal:

- business milestones;
- wait states;
- human ownership;
- failure boundaries;
- escalation;
- external dependency boundaries;
- irreversible side effect boundaries;
- compensation/repair points.

### 23.4 Rule

> A BPMN model is readable only if it helps production support understand consequences, not just sequence.

---

## 24. Anti-Pattern #22 — Missing Business Milestones

### 24.1 Bentuk Anti-Pattern

Process has technical tasks but no business phase markers.

Example:

```text
Call API A -> Call API B -> Call API C -> Call API D
```

No clear:

- submitted;
- under review;
- pending applicant response;
- approved;
- rejected;
- escalated;
- withdrawn;
- closed.

### 24.2 Impact

Analytics and support become difficult:

- Optimize report has technical nodes;
- SLA phase unclear;
- user status unclear;
- audit narrative poor;
- case status mapping fragile.

### 24.3 Correct Pattern

Add explicit milestones via:

- business task names;
- variables;
- domain events;
- subprocess boundary;
- phase update worker;
- Optimize-friendly model structure.

Example:

```text
Application Submitted
 -> Pre-Assessment
 -> Pending Applicant Clarification
 -> Officer Review
 -> Supervisor Approval
 -> Decision Issued
 -> Case Closed
```

### 24.4 Rule

> If a business stakeholder cannot map process progress to meaningful phase, the model is not production-ready.

---

## 25. Anti-Pattern #23 — Bad Multi-Instance Design

### 25.1 Bentuk Anti-Pattern

Multi-instance used for many items:

```text
for each document in 10,000 documents:
  verify document
```

Or:

```text
for each recipient in 100,000 recipients:
  send notification
```

### 25.2 Masalah

BPMN multi-instance is useful, but not always the right batch processing primitive.

Risks:

- huge number of jobs;
- payload explosion;
- difficult partial failure;
- backpressure;
- Operate noise;
- long incident list;
- retry storm;
- poor batch visibility;
- hard cancellation.

### 25.3 Better Pattern

For large batch:

```text
Start Batch Verification
 -> Wait Batch Completed Message
```

Batch service handles internal chunking, retries, progress, and idempotency.

Process tracks business milestone.

### 25.4 When Multi-Instance Is Good

Use it when:

- item count is bounded;
- each item is business-relevant;
- per-item visibility matters;
- per-item failure path matters;
- human review per item matters;
- completion aggregation is meaningful in BPMN.

### 25.5 Rule

> Multi-instance is not a substitute for a batch processing platform.

---

## 26. Anti-Pattern #24 — No Payload Governance for Forms and User Tasks

### 26.1 Bentuk Anti-Pattern

User task form submits arbitrary variable map:

```json
{
  "approved": true,
  "comment": "...",
  "caseStatus": "APPROVED",
  "riskLevel": "LOW",
  "internalDecision": {...},
  "systemFlags": {...}
}
```

Without validation.

### 26.2 Masalah

Human submitted variables can overwrite process variables unexpectedly.

Risks:

- user modifies protected fields;
- stale form overwrites newer value;
- approval without required reason;
- inconsistent decision payload;
- PII leak;
- wrong gateway route.

### 26.3 Correct Pattern

Form submission should go through:

- server-side validation;
- allowed field whitelist;
- domain permission check;
- version/stale check;
- decision command;
- audit record;
- controlled variable update.

### 26.4 Pattern

```text
User completes task
 -> custom app validates decision
 -> domain service records decision
 -> complete task/job/message with minimal controlled variables
```

### 26.5 Rule

> A form is a command interface, not a JSON editor.

---

## 27. Anti-Pattern #25 — Process Version Rollback Myth

### 27.1 Bentuk Anti-Pattern

Team assumes:

```text
If new BPMN has bug, we just rollback deployment.
```

### 27.2 Reality

Running process instances remain tied to their deployed process definition version unless migrated/modified/cancelled/restarted.

Rollback is not like replacing a stateless service binary.

You may have:

- old version running;
- new version running;
- broken instances created in new version;
- workers that changed contract;
- variables partially updated;
- incidents in both versions.

### 27.3 Correct Rollback Strategy

Plan:

```text
1. Deploy workers backward compatible
2. Deploy BPMN new version
3. Canary low-risk instances
4. Monitor incidents/metrics
5. If bad:
   - stop creating new instances on bad version
   - route new starts to old version if possible
   - migrate/modify/cancel affected instances
   - keep compatible worker until bad version drained
```

### 27.4 Rule

> Process rollback is operational remediation, not just redeploying an older BPMN file.

---

## 28. Anti-Pattern #26 — Ignoring Projection Lag in Dashboards and Alerts

### 28.1 Bentuk Anti-Pattern

Dashboard alert:

```text
If Operate/Elasticsearch shows no progress for 1 minute, alert critical.
```

Without considering exporter/secondary storage lag.

### 28.2 Masalah

Projection lag can create false alert or delayed detection.

### 28.3 Correct Observability

Monitor separately:

```text
- broker health
- gateway command latency
- exporter lag
- secondary storage health
- Operate query performance
- worker throughput
- business process progress
```

### 28.4 Rule

> Alert on symptoms with awareness of whether data source is command-side or projection-side.

---

## 29. Anti-Pattern #27 — Process as Notification Engine

### 29.1 Bentuk Anti-Pattern

BPMN contains every email/SMS/push notification as service task:

```text
Notify Applicant Received
Notify Officer Assigned
Notify Supervisor Pending
Notify Applicant Approved
Notify Applicant Rejected
Notify Admin Closed
Notify Reporting Team
...
```

### 29.2 Problem

Some notifications are business-critical; others are operational side effects.

Over-modeling every notification:

- bloats BPMN;
- creates incidents for low-value notification failure;
- blocks process unnecessarily;
- couples notification templates to process version;
- makes retries noisy.

### 29.3 Better Pattern

Classify notifications:

| Type | Pattern |
|---|---|
| Legally required decision notice | explicit BPMN task |
| Optional email reminder | event-driven notification service |
| Internal FYI | async domain event |
| User task reminder | SLA/notification service |
| Critical external notice | explicit task with audit |

### 29.4 Rule

> Model notifications explicitly only when they are process-critical or legally/audit significant.

---

## 30. Anti-Pattern #28 — No Domain Reconciliation Process

### 30.1 Bentuk Anti-Pattern

System relies only on happy path and retries.

No reconciliation for:

- external payment status;
- document generation;
- notification delivery;
- registry sync;
- callback missing;
- duplicate callback;
- unknown operation outcome.

### 30.2 Problem

Distributed systems require reconciliation.

Without it:

- cases stuck forever;
- duplicate side effects unresolved;
- manual support lacks evidence;
- audit incomplete;
- SLA breached silently.

### 30.3 Correct Pattern

Add reconciliation:

```text
Scheduled reconciliation job
 -> query operation ledger
 -> query external systems
 -> publish messages/commands to repair process
 -> escalate unresolved discrepancies
```

Sometimes reconciliation is outside Camunda. Sometimes it is a Camunda process. Choose based on business visibility.

### 30.4 Rule

> If an external side effect matters, you need reconciliation, not only retry.

---

## 31. Anti-Pattern #29 — No Clear Boundary Between Process Audit and Domain Audit

### 31.1 Bentuk Anti-Pattern

Team says:

```text
Camunda has history/exported records, so we don't need audit table.
```

### 31.2 Problem

Zeebe/exported records are process execution evidence, but domain audit often needs:

- who made business decision;
- what data was visible at decision time;
- what policy version applied;
- what reason code was selected;
- what evidence document was considered;
- what authorization allowed the action;
- what external reference was returned;
- what legal deadline applied;
- what override reason was provided.

### 31.3 Correct Design

Use layered audit:

```text
Process audit:
- process instance key
- flow node sequence
- incident/retry
- variable transitions

Domain audit:
- business action
- actor
- role
- decision
- reason
- evidence
- policy version
- before/after state

Operation audit:
- external call
- request id
- response id
- idempotency key
- reconciliation status
```

### 31.4 Rule

> Camunda audit explains process execution. Domain audit explains business accountability.

---

## 32. Anti-Pattern #30 — Modeling Every Exception Path Explicitly

### 32.1 Bentuk Anti-Pattern

BPMN has branches for:

- HTTP 400;
- HTTP 401;
- HTTP 403;
- HTTP 404;
- HTTP 409;
- HTTP 429;
- HTTP 500;
- timeout;
- DNS failure;
- mapping error;
- serialization error;
- downstream maintenance;
- validation error;
- null response;
- duplicate response.

### 32.2 Problem

Not every technical error deserves BPMN branch.

This makes model:

- unreadable;
- overfitted to implementation;
- brittle;
- hard to test;
- hard to maintain.

### 32.3 Correct Pattern

Classify errors into process-level categories:

```text
Business rejected
Waiting for external recovery
Needs manual repair
Cancelled/expired
Retryable technical failure
Non-retryable system incident
```

The worker maps low-level errors to high-level outcomes.

### 32.4 Rule

> Model business consequences, not every exception class.

---

## 33. Anti-Pattern #31 — Worker Logs Without Process Context

### 33.1 Bentuk Anti-Pattern

Logs:

```text
Failed to call registry
Timeout occurred
Invalid response
```

No:

- process instance key;
- job key;
- BPMN process id;
- job type;
- tenant id;
- business key/case id;
- operation id;
- correlation id;
- external request id.

### 33.2 Problem

Incident triage becomes slow.

Operator sees incident in Operate, but logs cannot be correlated.

### 33.3 Correct Logging Fields

Minimum:

```text
processInstanceKey
processDefinitionKey
bpmnProcessId
processVersion
elementId
jobKey
jobType
tenantId
caseId/businessId
operationId
correlationId
externalRequestId
attempt/retryCount
```

### 33.4 Rule

> A worker log line without process context is nearly useless during incident triage.

---

## 34. Anti-Pattern #32 — Worker Uses Process Variable Names Everywhere

### 34.1 Bentuk Anti-Pattern

Domain code accesses process variable map directly:

```java
String applicantId = (String) variables.get("applicantId");
BigDecimal income = new BigDecimal(variables.get("declaredIncome").toString());
```

Throughout domain logic.

### 34.2 Problem

Process variable schema leaks everywhere:

- no compile-time boundary;
- refactor dangerous;
- schema versioning hard;
- null handling inconsistent;
- tests fragile;
- domain coupled to Camunda.

### 34.3 Correct Pattern

Use contract mapper:

```text
ActivatedJob variables
 -> WorkerInput DTO
 -> DomainCommand
 -> DomainService
 -> WorkerOutput DTO
 -> Zeebe variables
```

### 34.4 Rule

> Camunda variables belong at adapter boundary, not inside domain core.

---

## 35. Anti-Pattern #33 — Mixing Tenant, Environment, and Business Identity

### 35.1 Bentuk Anti-Pattern

`caseId` is used for everything:

```text
business key
correlation key
tenant routing
environment routing
idempotency key
external operation key
log correlation id
```

### 35.2 Problem

One identifier rarely satisfies all scopes.

Example:

```text
CASE-123 exists in DEV, UAT, PROD
CASE-123 exists for tenant A and tenant B
CASE-123 has payment operation P1 and notification operation N1
```

### 35.3 Correct Identity Layers

Use separate identifiers:

| Identifier | Purpose |
|---|---|
| `caseId` | domain aggregate |
| `processInstanceKey` | Zeebe runtime |
| `tenantId` | isolation |
| `environment` | deployment/runtime isolation |
| `correlationKey` | message routing |
| `messageId` | message deduplication |
| `operationId` | side-effect idempotency |
| `traceId` | observability |
| `externalReference` | external system reconciliation |

### 35.4 Rule

> Identifier design is architecture, not naming convention.

---

## 36. Anti-Pattern #34 — Treating Camunda as System of Record for Documents

### 36.1 Bentuk Anti-Pattern

Documents stored as:

- base64 variables;
- full OCR text;
- PDF bytes;
- full attachment metadata;
- generated report content.

### 36.2 Problem

Camunda is not a document management system.

Use:

- object storage;
- document service;
- metadata DB;
- retention/legal hold service;
- virus scanning;
- access control;
- versioning;
- content hash.

Process variable should contain:

```json
{
  "documentBundleId": "DOCB-123",
  "requiredDocumentStatus": "COMPLETE"
}
```

### 36.3 Rule

> Store document references in process variables, not documents.

---

## 37. Anti-Pattern #35 — Inconsistent Error Code Taxonomy

### 37.1 Bentuk Anti-Pattern

Different workers produce:

```text
INVALID
VALIDATION_ERROR
ERR_400
BAD_REQUEST
REJECTED
FAILED
NOT_OK
```

No shared meaning.

### 37.2 Impact

- BPMN branches inconsistent;
- reports unreliable;
- support confused;
- test cases incomplete;
- incident prioritization poor;
- migration risky.

### 37.3 Correct Error Taxonomy

Define error catalog:

```text
BUSINESS_NOT_ELIGIBLE
BUSINESS_DOCUMENT_INCOMPLETE
BUSINESS_PAYMENT_DECLINED
TECH_EXTERNAL_TIMEOUT
TECH_EXTERNAL_UNAVAILABLE
TECH_SCHEMA_INVALID
TECH_AUTHORIZATION_FAILED
TECH_UNKNOWN_OUTCOME
```

Each error code has:

- category;
- retryable?;
- BPMN mapping;
- incident severity;
- user-visible?;
- audit relevance;
- owner;
- remediation.

### 37.4 Rule

> Error codes are process contracts.

---

## 38. Anti-Pattern #36 — Using BPMN Gateways for Complex Domain Rules

### 38.1 Bentuk Anti-Pattern

Exclusive gateway condition contains complex FEEL/JUEL-like business logic:

```text
income > threshold and riskScore < x and country in list and licenseType...
```

Many branches.

### 38.2 Problem

Gateway expressions are good for simple routing based on already-computed facts.

Complex rules belong in:

- domain service;
- DMN decision table;
- rules engine;
- policy service.

### 38.3 Better Pattern

```text
Evaluate Eligibility
 -> result: APPROVED / NEEDS_REVIEW / REJECTED
 -> gateway routes based on result
```

### 38.4 Rule

> Gateways should route on decisions, not become hidden decision engines.

---

## 39. Anti-Pattern #37 — No Deployment Compatibility Window

### 39.1 Bentuk Anti-Pattern

Deploy order:

```text
1. Deploy BPMN expecting worker v2
2. Later deploy worker v2
```

During gap, jobs fail.

Or:

```text
1. Deploy worker v2 that no longer supports old schema
2. Old process instances still produce old jobs
```

### 39.2 Correct Deployment Order

Backward-compatible rollout:

```text
1. Deploy worker supporting old + new contract
2. Deploy BPMN producing new contract
3. Monitor
4. Drain old instances
5. Remove old support later
```

### 39.3 Rule

> In Camunda 8, deployment order is part of correctness.

---

## 40. Anti-Pattern #38 — No Runbook for Manual Modification

### 40.1 Bentuk Anti-Pattern

Operate process instance modification is allowed, but no governance:

- who may modify?
- when?
- what evidence required?
- what variable repair allowed?
- how to record reason?
- how to test after modification?
- how to notify business owner?

### 40.2 Risk

Manual modification can:

- skip required control;
- bypass segregation of duties;
- create audit gap;
- complete wrong path;
- hide root cause;
- break downstream assumptions.

### 40.3 Correct Governance

Manual modification requires:

```text
incident id
business approval
technical root cause
target process instance
before state snapshot
planned modification
expected after state
risk assessment
operator identity
timestamp
post-check result
audit record
```

### 40.4 Rule

> Manual repair is a controlled production change.

---

## 41. Anti-Pattern #39 — Treating Zeebe Partitioning as Invisible

### 41.1 Bentuk Anti-Pattern

Design assumes global ordering across all process instances.

Example:

```text
If event A and event B are published, all processes will observe them in global order.
```

### 41.2 Problem

Zeebe partitions provide ordering within a partition stream, not global total ordering across all process instances and external systems.

### 41.3 Correct Thinking

For cross-instance ordering:

- use domain sequence;
- use external event log;
- use aggregate-level ordering;
- use correlation key per aggregate;
- use optimistic locking;
- design idempotent consumers.

### 41.4 Rule

> Do not build global business ordering on implicit engine execution order.

---

## 42. Anti-Pattern #40 — No Process Instance Start Deduplication

### 42.1 Bentuk Anti-Pattern

API endpoint creates process instance on every request:

```text
POST /applications/{id}/submit
 -> create process instance
```

If user double clicks or client retries, two process instances start.

### 42.2 Correct Pattern

Use domain guard:

```text
Submit command
 -> domain transaction checks application not already submitted
 -> persist process start intent
 -> create process instance with idempotency handling
 -> store processInstanceKey
```

For message start, use correlation key/message id discipline if applicable.

### 42.3 Rule

> Starting a process is a business state transition; protect it like one.

---

## 43. Production Failure Case Study #1 — Duplicate Payment After Worker Timeout

### 43.1 Context

Process:

```text
Submit Order
 -> Charge Payment
 -> Confirm Order
```

Worker:

```text
chargePayment
```

Implementation:

```text
1. Call payment provider
2. Complete job
```

No idempotency key.

### 43.2 Incident Timeline

```text
10:00:00 Worker activates Charge Payment job
10:00:01 Worker sends charge request
10:00:04 Payment provider charges card
10:00:05 Worker complete job command times out
10:00:30 Job timeout expires
10:00:31 Another worker activates same job
10:00:32 Worker sends second charge request
10:00:35 Payment provider charges card again
10:00:36 Job completes
10:05:00 Customer sees duplicate charge
```

### 43.3 Root Cause

- Worker assumed complete command outcome known.
- External payment call had no idempotency key.
- No operation ledger.
- No reconciliation before retry.
- Job timeout too short for real external operation.
- Payment operation modelled as synchronous final success.

### 43.4 Fix

Design:

```text
operationId = PAYMENT_REQUEST:{orderId}:{paymentAttempt}
```

Worker:

```text
1. Insert operation ledger STARTED
2. Call provider with idempotency key
3. Store provider transaction id
4. Mark operation SUBMITTED/CHARGED
5. Complete job
```

If timeout:

```text
- query provider by operationId
- if charged, complete/replay
- if not found, retry safely
- if ambiguous, incident/manual review
```

### 43.5 BPMN Improvement

```text
Submit Payment Request
 -> Wait for Payment Confirmed Message
 -> Confirm Order
```

With timer:

```text
Wait Payment Confirmed
 --after PT30M--> Reconcile Payment
```

### 43.6 Lesson

> Money-moving workers require external idempotency plus internal operation ledger.

---

## 44. Production Failure Case Study #2 — Stuck Onboarding Because Message Arrived Too Early

### 44.1 Context

Process:

```text
Start Onboarding
 -> Create External Account
 -> Wait Account Activated Message
 -> Continue
```

External system sometimes sends activation callback immediately.

### 44.2 Incident

Message was published with TTL = 0 or too short. It arrived before process reached catch event. Message was not buffered. Process waited forever.

### 44.3 Root Cause

- No understanding of message TTL.
- No domain callback buffer.
- Worker completed account creation after callback already arrived.
- No reconciliation timer.
- Operate showed process waiting, but external system already completed.

### 44.4 Fix

Use:

```text
message TTL > expected race window
messageId for deduplication
correlationKey stable operationId
callback handler stores event in domain inbox
process catch event consumes message
timer triggers reconciliation if no message
```

### 44.5 Lesson

> Message correlation design must handle early, late, duplicate, and missing messages.

---

## 45. Production Failure Case Study #3 — Runaway Incidents After Worker Schema Change

### 45.1 Context

Worker v1 expected:

```json
{
  "customerId": "C-1"
}
```

Worker v2 expected:

```json
{
  "customer": {
    "id": "C-1"
  }
}
```

BPMN changed and worker deployed same day.

### 45.2 Incident

Old running instances still produced jobs with v1 variable shape. Worker v2 failed with null pointer. Hundreds of incidents created.

### 45.3 Root Cause

- No versioned job type.
- No contract version.
- No backward-compatible worker.
- No release compatibility plan.
- No test with old process instances.
- No canary.

### 45.4 Fix

Deploy worker that supports both:

```text
if contractVersion == 1 -> parse v1
if contractVersion == 2 -> parse v2
```

Or separate:

```text
assess-risk.v1
assess-risk.v2
```

### 45.5 Lesson

> Running process instances are long-lived clients of your worker contract.

---

## 46. Production Failure Case Study #4 — Wrong Case Received Callback

### 46.1 Context

Correlation key used:

```text
applicantEmail
```

Two applications from same applicant were active.

### 46.2 Incident

External verification callback for application B correlated to application A.

### 46.3 Root Cause

- Correlation key not unique per operation.
- Email is mutable and not operation-specific.
- No domain operation lookup before publishing message.
- No tenant/case/operation scoping.
- Callback handler trusted external payload.

### 46.4 Fix

Use:

```text
correlationKey = tenantId + ":" + verificationRequestId
```

Domain table:

```text
verification_request
- verificationRequestId
- caseId
- processInstanceKey
- tenantId
- status
- externalReference
```

Callback handler validates external reference, tenant, status, signature, and expected operation.

### 46.5 Lesson

> Correlation key is a routing address. Treat it like a critical identifier.

---

## 47. Production Failure Case Study #5 — Operate Dashboard Said “Not Approved” But Domain Already Approved

### 47.1 Context

Custom UI queried Operate to check whether approval step completed.

### 47.2 Incident

Exporter lag caused UI to show outdated state. User retried action, causing duplicate domain command.

### 47.3 Root Cause

- Operate projection used for business command decision.
- No domain state guard.
- No idempotent submit command.
- No understanding of projection lag.

### 47.4 Fix

Business UI uses domain case status from domain DB.

Operate remains support tool.

Domain command:

```text
approve(caseId, decisionId)
```

Uses optimistic locking/idempotency.

Process is notified via message/command after domain transition.

### 47.5 Lesson

> Use Operate for operational observation, not transactional business authorization.

---

## 48. Production Failure Case Study #6 — Notification Incident Blocked License Issuance

### 48.1 Context

Process:

```text
Approve License
 -> Send Internal FYI Email
 -> Issue License
```

Email service down. License issuance stuck.

### 48.2 Root Cause

- Optional notification modelled as blocking process step.
- No classification of notification criticality.
- Retry created incident that blocked business value.
- No async notification service.

### 48.3 Fix

If email legally required before issuance:

```text
Approve -> Issue Decision Notice -> Issue License
```

If FYI optional:

```text
Approve -> Issue License
       -> publish domain event LicenseApproved
Notification service sends FYI asynchronously
```

### 48.4 Lesson

> Not every side effect deserves to block process progress.

---

## 49. Production Failure Case Study #7 — Giant Variable Broke Process Progress

### 49.1 Context

Worker stored full external API response in process variable, including document metadata and large nested arrays.

### 49.2 Incident

Process variable payload exceeded limit. Job completion failed. Incidents appeared. Operate variable view became hard to use.

### 49.3 Root Cause

- Process variables used as API response archive.
- No payload size budget.
- No PII/data minimization.
- No reference-over-payload strategy.
- No variable schema governance.

### 49.4 Fix

Store full response in domain storage:

```text
external_api_response table/blob
- responseId
- caseId
- provider
- contentHash
- encryptedPayload
- retentionPolicy
```

Process variable:

```json
{
  "screeningResultId": "SCR-123",
  "screeningOutcome": "HIT",
  "riskLevel": "HIGH"
}
```

### 49.5 Lesson

> Put routing facts in variables, put records in governed storage.

---

## 50. Production Failure Case Study #8 — Retry Storm Took Down External Registry

### 50.1 Context

Registry API had intermittent 503.

Worker configured:

```text
maxJobsActive high
many replicas
immediate retry
no rate limit
```

### 50.2 Incident

When registry degraded, workers retried aggressively and amplified traffic, making registry outage worse.

### 50.3 Root Cause

- No retry backoff.
- No circuit breaker/rate limiter.
- No external dependency budget.
- `maxJobsActive` tuned only for happy path.
- No dead-letter/manual escalation after threshold.

### 50.4 Fix

- classify 503 as retryable with backoff;
- limit concurrency per dependency;
- use circuit breaker;
- reduce max jobs active;
- fail to incident after bounded retries;
- add reconciliation process;
- alert on dependency error rate.

### 50.5 Lesson

> Worker concurrency must be constrained by downstream capacity, not only Camunda capacity.

---

## 51. Production Failure Case Study #9 — Manual Process Modification Skipped Required Review

### 51.1 Context

Incident stuck at review task due to variable issue. Operator modified process instance to skip review and continue to approval.

### 51.2 Incident

Later audit found required review missing.

### 51.3 Root Cause

- No manual modification governance.
- No approval workflow for intervention.
- No audit record linking incident to modification.
- No post-check.
- Operator did not understand business control.

### 51.4 Fix

Manual intervention policy:

```text
- only specific support role
- business approval required
- modification reason mandatory
- pre/post snapshot
- audit ticket
- compensating review if skipped
- report interventions weekly
```

### 51.5 Lesson

> Repairing process state can change business legality. Govern it.

---

## 52. Production Failure Case Study #10 — BPMN Looked Correct but SLA Dashboard Was Useless

### 52.1 Context

BPMN model had many technical service tasks but no phase milestones.

Optimize dashboard showed average time per technical node, but business asked:

```text
How long from submission to first officer review?
How long applicant waits for clarification?
How long supervisor approval takes?
How many cases breach statutory deadline?
```

Dashboard could not answer.

### 52.2 Root Cause

- Model optimized for execution, not analytics.
- No explicit phase markers.
- No milestone variables.
- No business timestamps in domain audit.
- No SLA clock design.

### 52.3 Fix

Add business phases:

```text
SUBMITTED
PRE_ASSESSMENT
PENDING_CLARIFICATION
UNDER_OFFICER_REVIEW
PENDING_SUPERVISOR_APPROVAL
DECISION_ISSUED
CLOSED
```

Persist domain phase timestamps. Align BPMN milestones with Optimize reports.

### 52.4 Lesson

> If you need process intelligence, model business milestones intentionally.

---

## 53. Design Smell Catalog

Use this catalog during design review.

### 53.1 BPMN Smells

| Smell | Likely Risk |
|---|---|
| Every API call is a service task | call graph modelling |
| Huge diagram | poor modularity |
| No explicit milestones | poor analytics/audit |
| Every exception has gateway branch | overfitted technical modelling |
| No timer for external wait | stuck process |
| Too many timers | scheduler abuse |
| No boundary errors | poor business exception handling |
| All errors are BPMN errors | technical failures hidden |
| All errors are incidents | business outcomes misclassified |
| Multi-instance over huge collection | batch overload |
| No call activity boundaries | poor reuse/versioning |
| Optional notification blocks process | false dependency |
| Gateways contain complex rules | hidden decision logic |
| No cancellation/withdrawal path | lifecycle incomplete |
| No repair path | support difficult |

### 53.2 Worker Smells

| Smell | Likely Risk |
|---|---|
| No idempotency store | duplicate side effects |
| Complete before side effect | false process success |
| External call without operation id | unknown outcome |
| Catch all and retry | retry storm |
| No error taxonomy | inconsistent process behavior |
| No timeout tuning | duplicate execution |
| No graceful shutdown | in-flight job timeout |
| No variable validation | incidents/data corruption |
| Direct variable map in domain code | schema coupling |
| No process context in logs | poor triage |
| No owner/runbook | orphaned incident |
| Worker only tested happy path | production fragility |
| High maxJobsActive by default | downstream overload |

### 53.3 Variable Smells

| Smell | Likely Risk |
|---|---|
| Large nested JSON | payload/performance issue |
| Base64 documents | storage/privacy issue |
| Raw external response | PII/projection bloat |
| No contract version | migration failure |
| Mutable PII as key | correlation/security issue |
| Null semantics unclear | gateway bugs |
| User form overwrites variables | unauthorized mutation |
| Variable names used everywhere | coupling |
| No schema ownership | contract drift |

### 53.4 Message Smells

| Smell | Likely Risk |
|---|---|
| Correlation key is email | wrong instance |
| No message id | duplicate handling weak |
| TTL = 0 for race-prone callback | lost message |
| No callback signature | replay/security issue |
| No tenant/env in key | cross-tenant/environment bug |
| No callback inbox | missing reconciliation |
| External system directly controls correlation | injection/misrouting |
| No late callback handling | inconsistent process |

### 53.5 Operations Smells

| Smell | Likely Risk |
|---|---|
| Retry incidents without triage | duplicate/corruption |
| No exporter lag monitoring | stale dashboards |
| Operate used for business decision | race condition |
| No process version ledger | release confusion |
| No manual modification policy | audit risk |
| No backup restore drill | false resilience |
| No worker compatibility window | incident on deploy |
| No runbook per job type | slow MTTR |
| No dashboard by job type | hidden bottleneck |
| No reconciliation process | stuck/unknown cases |

---

## 54. Anti-Pattern Refactoring Playbook

### 54.1 If BPMN Is Too Technical

Refactor:

```text
Technical call sequence
 -> business service task
 -> domain service handles internal calls
 -> BPMN shows meaningful milestones
```

### 54.2 If Worker Is Not Idempotent

Add:

```text
operation ledger
idempotency key
external reference
result replay
reconciliation
bounded retry
```

### 54.3 If Variables Are Too Large

Move to:

```text
domain DB
document store
audit table
object storage
analytics table
```

Keep only:

```text
ids
routing facts
small decision results
phase/status
correlation fields
```

### 54.4 If Correlation Is Unsafe

Introduce:

```text
operation id
tenant id
message id
domain callback table
signature validation
TTL policy
late/duplicate handling
```

### 54.5 If Incidents Are Noisy

Classify:

```text
business rejection -> BPMN path
transient technical -> retry
deterministic technical -> incident
unknown outcome -> reconcile
operator repair -> controlled modification
```

### 54.6 If Release Breaks Running Instances

Add:

```text
versioned job type
contractVersion
backward-compatible worker
deployment order
canary
process registry
migration plan
```

### 54.7 If Support Cannot Debug

Add:

```text
process context logs
job type owner
runbook
dashboard
operation ledger
domain audit
Operate triage guide
correlation id propagation
```

---

## 55. Production Readiness Questions

Before approving a Camunda 8 design, ask these.

### 55.1 Process Model

```text
1. What are the business milestones?
2. Which tasks are wait states?
3. Which steps have irreversible side effects?
4. Which failures are business outcomes?
5. Which failures are technical incidents?
6. What can be retried safely?
7. What requires manual repair?
8. What happens if external callback never arrives?
9. What happens if external callback arrives twice?
10. What happens if external callback arrives early?
11. Is every service task business meaningful?
12. Is the diagram readable for support?
13. Are analytics/SLA needs reflected?
```

### 55.2 Worker

```text
1. What is the job type contract?
2. Is the worker idempotent?
3. What idempotency key is used?
4. What external side effect can happen?
5. What is the unknown outcome strategy?
6. What is retryable?
7. What is non-retryable?
8. What is BPMN error?
9. What creates incident?
10. What logs/metrics/traces are emitted?
11. What is maxJobsActive based on?
12. What is job timeout based on?
13. What happens during shutdown?
14. Who owns the worker?
```

### 55.3 Variables

```text
1. What variables are required?
2. Who owns schema?
3. Is there a contract version?
4. Are variables small?
5. Are PII fields minimized?
6. Are documents referenced, not embedded?
7. Are gateway conditions simple?
8. Are form outputs controlled?
9. Are variables safe for Operate visibility?
```

### 55.4 Message Correlation

```text
1. What is correlation key?
2. What is uniqueness scope?
3. Is tenant/environment included if needed?
4. What is message id?
5. What is TTL?
6. What if message arrives early?
7. What if message arrives late?
8. What if message duplicates?
9. What validates callback authenticity?
10. Is there callback inbox/reconciliation?
```

### 55.5 Operations

```text
1. What dashboard shows stuck jobs?
2. What dashboard shows exporter lag?
3. What dashboard shows worker failures?
4. What dashboard shows business SLA?
5. What runbook handles incident?
6. What is manual modification policy?
7. What is rollback strategy?
8. What is backup/restore strategy?
9. What is process version migration strategy?
10. Who is on-call?
```

---

## 56. Staff-Level Heuristics

These are practical heuristics that help prevent production failure.

### 56.1 Model Fewer, More Meaningful Service Tasks

If a service task is not meaningful for support, retry, audit, or business progress, consider moving it inside a domain service.

### 56.2 Every Side Effect Needs an Operation ID

No operation id means no reliable reconciliation.

### 56.3 Unknown Outcome Is a First-Class State

Never collapse timeout into failure.

### 56.4 Prefer Explicit Business Outcomes Over Technical Branches

Gateways should route business decisions, not HTTP codes.

### 56.5 Keep Process Variables Boring

Boring variables are good variables:

```text
ids
statuses
flags
small decisions
timestamps
correlation fields
```

### 56.6 Treat Running Instances as Long-Lived Clients

Any worker/process contract change must respect instances created weeks/months ago.

### 56.7 Design for Operator Understanding

If production support cannot understand the process, the process is not production-ready.

### 56.8 Separate Observation from Decision

Operate/Optimize dashboards observe. Domain command systems decide.

### 56.9 Use Incidents Intentionally

Incident should mean “operator/system repair needed,” not “normal business rejection.”

### 56.10 Design the Failure Path Before Happy Path

Happy path proves the demo. Failure path proves the architecture.

---

## 57. Minimal Templates

### 57.1 Job Type Contract Template

```markdown
# Job Type Contract

## Job Type
`assessment.perform.v2`

## Owner
Assessment Service Team

## Business Meaning
Perform regulatory pre-assessment for submitted application.

## Input Variables
- `caseId: string`
- `tenantId: string`
- `assessmentRequestId: string`
- `contractVersion: number`

## Output Variables
- `assessmentResultId: string`
- `assessmentOutcome: APPROVED | NEEDS_REVIEW | REJECTED`
- `riskLevel: LOW | MEDIUM | HIGH`

## Side Effects
- Writes assessment result to domain DB
- Calls registry screening API
- Stores operation ledger

## Idempotency Key
`ASSESSMENT:{tenantId}:{assessmentRequestId}`

## Retry Policy
- Registry timeout: retry with backoff
- Registry 429: retry with rate limit
- Invalid input: incident
- Business rejection: BPMN path

## BPMN Errors
- `ASSESSMENT_REJECTED`
- `DOCUMENT_INCOMPLETE`

## Incidents
- Schema invalid
- Authorization config error
- Unknown external outcome after reconciliation

## Observability
- logs include processInstanceKey, jobKey, caseId, operationId
- metrics by outcome/error type

## Runbook
`RUN-ASSESSMENT-002`
```

### 57.2 Message Contract Template

```markdown
# Message Contract

## Message Name
`PaymentConfirmed`

## Business Meaning
Payment provider confirmed payment operation.

## Correlation Key
`{tenantId}:{paymentRequestId}`

## Message ID
`{providerEventId}`

## TTL
`PT24H`

## Variables
- `paymentRequestId`
- `paymentStatus`
- `providerTransactionId`
- `confirmedAt`

## Duplicate Handling
Duplicate provider event id ignored.

## Early Arrival Handling
Callback inbox stores event. Message TTL covers expected process wait race.

## Late Arrival Handling
If process no longer waits, callback handler checks domain state and records late event.

## Security
- signature validation
- timestamp replay window
- tenant validation

## Reconciliation
Scheduled reconciler queries provider by paymentRequestId.
```

### 57.3 Incident Runbook Template

```markdown
# Incident Runbook

## Incident Type
`assessment.perform.v2` failed

## First Questions
1. Is external side effect already executed?
2. Is retry idempotent?
3. Is variable schema valid?
4. Is dependency healthy?
5. Is worker version compatible?

## Evidence to Collect
- processInstanceKey
- jobKey
- jobType
- tenantId
- caseId
- operationId
- externalRequestId
- worker logs
- operation ledger row
- external system status

## Safe Actions
- retry only after dependency recovered
- repair variable if schema issue
- deploy fixed worker if code issue
- reconcile unknown outcome before retry
- escalate to business if manual decision required

## Unsafe Actions
- blind retry
- skip activity without business approval
- modify variable without audit ticket
- cancel process without domain rollback
```

---

## 58. Closing Mental Model

Camunda 8/Zeebe gives you a durable orchestration engine, but it does not magically solve distributed systems correctness.

It gives you:

- durable process state;
- job activation;
- retries;
- incidents;
- message correlation;
- timers;
- process visibility;
- human task management;
- projections;
- operational tooling.

But you still own:

- idempotency;
- external side effect correctness;
- domain state;
- audit defensibility;
- variable governance;
- security boundary;
- worker contract versioning;
- deployment compatibility;
- reconciliation;
- support runbooks.

The biggest production lesson:

```text
Camunda orchestrates progress.
Your architecture must make progress safe.
```

If you remember one thing from this part:

> A Camunda 8 design is not production-ready because the BPMN deploys and the worker completes jobs. It is production-ready when duplicate execution, projection lag, timeout ambiguity, message races, worker version drift, manual repair, and audit explanation are all intentionally handled.

---

## 59. Part Summary

Dalam bagian ini, kita membahas:

- anti-pattern BPMN sebagai microservice call graph;
- giant process model;
- variables as database;
- non-idempotent worker;
- complete-before-side-effect;
- blind retry;
- BPMN error vs job failure misuse;
- unsafe message correlation;
- Operate as false source of truth;
- unversioned worker contract;
- connector misuse;
- long synchronous worker call;
- timer abuse;
- unknown outcome handling;
- hidden domain state machine;
- human task authorization risk;
- incident retry anti-pattern;
- worker ownership;
- environment-unsafe callback;
- missing business milestones;
- multi-instance misuse;
- form payload governance;
- process rollback myth;
- projection lag;
- notification over-modelling;
- no reconciliation process;
- audit boundary confusion;
- excessive exception modelling;
- missing process context in logs;
- variable schema leakage;
- identifier scope confusion;
- document storage misuse;
- inconsistent error taxonomy;
- complex domain rules in gateways;
- deployment compatibility;
- manual modification governance;
- partition/global ordering assumption;
- process start deduplication;
- 10 production failure case studies;
- smell catalog;
- refactoring playbook;
- production readiness questions;
- staff-level heuristics;
- reusable templates.

---

## 60. Status Seri

Seri **belum selesai**.

Bagian berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-034.md
```

Judul:

```text
Part 034 — End-to-End Reference Architecture: Production-Grade Java Camunda 8 System
```

Fokus berikutnya adalah menyatukan seluruh materi ke dalam satu reference architecture production-grade: proses regulatory lifecycle, Java worker services, domain services, operation ledger, message callback, audit trail, custom task UI, observability, security, deployment topology, testing, dan operational runbook.

---

## 61. Referensi

Dokumentasi dan sumber yang relevan untuk bagian ini:

1. Camunda 8 Docs — Job Workers  
   `https://docs.camunda.io/docs/components/concepts/job-workers/`

2. Camunda 8 Docs — Dealing with Problems and Exceptions  
   `https://docs.camunda.io/docs/components/best-practices/development/dealing-with-problems-and-exceptions/`

3. Camunda 8 Docs — Variables  
   `https://docs.camunda.io/docs/components/concepts/variables/`

4. Camunda 8 Docs — Handling Data in Processes  
   `https://docs.camunda.io/docs/components/best-practices/development/handling-data-in-processes/`

5. Camunda 8 Docs — Messages  
   `https://docs.camunda.io/docs/components/concepts/messages/`

6. Camunda 8 Docs — Message Events  
   `https://docs.camunda.io/docs/components/modeler/bpmn/message-events/`

7. Camunda 8 Docs — Operate Introduction  
   `https://docs.camunda.io/docs/components/operate/operate-introduction/`

8. Camunda 8 Docs — Process Instance Modification  
   `https://docs.camunda.io/docs/components/operate/userguide/process-instance-modification/`

9. Camunda 8 Docs — Exporters  
   `https://docs.camunda.io/docs/self-managed/concepts/exporters/`

10. Camunda 8 Docs — Reporting About Processes  
    `https://docs.camunda.io/docs/components/best-practices/operations/reporting-about-processes/`

11. Camunda Blog — Performance Tuning in Camunda 8  
    `https://camunda.com/blog/2025/01/performance-tuning-camunda-8/`

12. Camunda 8 Docs — Backup and Restore  
    `https://docs.camunda.io/docs/self-managed/operational-guides/backup-restore/backup-and-restore/`


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-032.md">⬅️ Part 032 — Security, Compliance, Audit Trail, PII, and Regulated Workflow Defensibility</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-034.md">Part 034 — End-to-End Reference Architecture: Production-Grade Java Camunda 8 System ➡️</a>
</div>
