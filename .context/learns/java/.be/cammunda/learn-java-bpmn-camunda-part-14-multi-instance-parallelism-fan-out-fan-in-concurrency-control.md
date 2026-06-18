# learn-java-bpmn-camunda-process-orchestration-engineering

## Part 14 — Multi-instance, Parallelism, Fan-out/Fan-in, and Concurrency Control

> Seri: Java BPMN, Camunda, Process Orchestration Engineering  
> Target: Java 8 hingga Java 25  
> Fokus: memahami dan mendesain paralelisme proses yang aman, bisa diaudit, bisa dioperasikan, dan tidak menciptakan race condition tersembunyi.

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membahas timer, SLA, timeout, dan scheduled process behavior. Sekarang kita masuk ke salah satu area yang sering terlihat sederhana di diagram, tetapi sangat berbahaya di production: **parallelism**.

Dalam BPMN, paralelisme bisa terlihat hanya seperti satu gateway bercabang menjadi banyak jalur. Tetapi di runtime, ia berarti:

- ada lebih dari satu token aktif dalam process instance yang sama;
- ada lebih dari satu job/user task/timer/message subscription yang bisa aktif bersamaan;
- ada lebih dari satu worker atau user yang bisa mengubah data yang tampak “sama”;
- ada kemungkinan race condition antara branch yang selesai lebih cepat, branch yang gagal, branch yang timeout, dan branch yang dikompensasi;
- ada implikasi ke throughput, rate limit, SLA, audit, dan manual repair.

Top engineer tidak hanya bertanya:

> “Bisa diparalelkan?”

Tetapi bertanya:

> “Apa consistency boundary-nya, siapa owner state-nya, apa yang terjadi jika salah satu branch gagal, bagaimana join dilakukan, bagaimana partial completion dihitung, bagaimana data hasil branch digabung, dan bagaimana ini diperbaiki saat stuck?”

---

## 2. Mental Model Utama: Parallelism di BPMN Bukan Threading Java

Kesalahan umum engineer Java adalah menyamakan BPMN parallelism dengan `Thread`, `CompletableFuture`, `ExecutorService`, atau virtual threads.

Itu keliru.

BPMN parallelism adalah **parallel token progression**, bukan selalu parallel CPU execution.

Artinya:

- engine mengaktifkan beberapa jalur proses;
- setiap jalur bisa mencapai wait state berbeda;
- service task menghasilkan job berbeda;
- job bisa diambil worker berbeda;
- user task bisa muncul ke user berbeda;
- timer/message bisa aktif bersamaan;
- join gateway menunggu token tertentu, bukan menunggu Java thread.

Contoh sederhana:

```text
Start
  -> Parallel Gateway Split
       -> Check Applicant Profile
       -> Check Payment Status
       -> Check Document Completeness
  -> Parallel Gateway Join
  -> Continue Assessment
```

Ini tidak berarti engine menjalankan tiga method Java dalam satu transaction. Yang terjadi adalah proses membuat tiga path aktif. Kalau tiap path berisi service task, engine menciptakan tiga job. Tiga job itu bisa dikerjakan worker yang sama, worker berbeda, pod berbeda, atau bahkan tidak dikerjakan sama sekali jika worker down.

Konsekuensinya:

1. jangan berbagi mutable state tanpa kontrol;
2. jangan mengandalkan urutan penyelesaian branch;
3. jangan menulis hasil branch ke variable global yang sama tanpa desain merge;
4. jangan menganggap branch lain sudah selesai hanya karena branch saat ini selesai;
5. jangan menganggap join akan otomatis “memahami” business completeness.

---

## 3. Parallel Gateway: AND Split dan AND Join

### 3.1 Apa itu parallel gateway

Parallel gateway adalah gateway BPMN untuk membuat semua outgoing flow berjalan. Saat masuk ke split parallel gateway, seluruh outgoing sequence flow diaktifkan.

```text
        +--> A -->+
Start --+--> B -->+--> Continue
        +--> C -->+
```

Dalam Camunda, parallel gateway dengan banyak outgoing flow mengambil semua flow. Untuk join gateway dengan banyak incoming flow, process instance menunggu sampai setiap incoming sequence flow diterima sebelum melanjutkan.

### 3.2 Parallel gateway bukan conditional branching

Parallel gateway tidak bertanya:

```text
if condition A then go A
if condition B then go B
```

Ia melakukan:

```text
start A
start B
start C
```

Kalau hanya satu dari beberapa jalur boleh diambil, gunakan exclusive gateway. Kalau beberapa jalur dapat dipilih berdasarkan kondisi, gunakan inclusive gateway, tetapi dengan kehati-hatian tinggi.

### 3.3 Join semantics

Parallel join menunggu semua incoming flow yang sesuai struktur proses.

Contoh:

```text
Parallel Split
  -> Branch A
  -> Branch B
Parallel Join
  -> Next
```

Jika Branch A selesai tetapi Branch B stuck di user task, process instance akan tetap menunggu di join.

Ini benar secara teknis, tetapi bisa salah secara bisnis jika requirement sebenarnya adalah:

- lanjut setelah salah satu selesai;
- lanjut setelah mayoritas selesai;
- lanjut setelah mandatory approval selesai;
- lanjut setelah semua mandatory selesai dan optional boleh lewat;
- lanjut setelah timeout branch yang lambat.

Untuk kasus itu, jangan pakai parallel join polos tanpa desain completion rule.

---

## 4. Kapan Parallel Gateway Cocok

Parallel gateway cocok jika semua kondisi berikut terpenuhi:

1. **Semua branch harus dijalankan.**
2. **Semua branch harus selesai sebelum lanjut.**
3. **Branch relatif independen.**
4. **Tidak ada kebutuhan quorum/partial completion.**
5. **Join semantics sederhana: all completed.**
6. **Failure handling jelas untuk setiap branch.**
7. **Data hasil branch bisa digabung secara deterministik.**

Contoh cocok:

```text
Application Submitted
  -> Parallel Split
       -> Validate Applicant Identity
       -> Validate Submitted Documents
       -> Validate Fee Payment
  -> Parallel Join
  -> Determine Completeness
```

Seluruh validasi wajib selesai sebelum proses bisa menentukan completeness.

---

## 5. Kapan Parallel Gateway Tidak Cocok

Parallel gateway tidak cocok jika requirement sebenarnya adalah:

1. **N dari M approval cukup.**
2. **Salah satu branch menang, lainnya dibatalkan.**
3. **Ada timeout yang membuat branch lain tidak perlu ditunggu.**
4. **Branch optional.**
5. **Jumlah branch dinamis berdasarkan data.**
6. **Branch memiliki rate limit ketat ke external system.**
7. **Branch saling bergantung pada data yang dihasilkan branch lain.**
8. **Hasil branch perlu merge kompleks.**

Untuk kasus dinamis, pertimbangkan multi-instance. Untuk quorum, gunakan multi-instance dengan completion condition atau modeling eksplisit. Untuk race “siapa duluan menang”, gunakan event-based gateway atau event subprocess sesuai semantik.

---

## 6. Multi-instance: Repeating Activity Berdasarkan Collection

### 6.1 Apa itu multi-instance

Multi-instance memungkinkan satu activity dijalankan berkali-kali untuk kumpulan item.

Contoh:

```text
For each required agency:
  Request Agency Opinion
```

Jika ada 5 agency, maka task dijalankan 5 kali.

Multi-instance bisa:

- sequential;
- parallel.

Sequential:

```text
Agency 1 -> Agency 2 -> Agency 3 -> Done
```

Parallel:

```text
Agency 1 --+
Agency 2 --+--> Done
Agency 3 --+
```

### 6.2 Multi-instance vs parallel gateway

Parallel gateway cocok untuk branch yang diketahui di design time:

```text
Check Payment
Check Documents
Check Applicant
```

Multi-instance cocok untuk branch dinamis berdasarkan data runtime:

```text
for each agency in requiredAgencies
for each document in requiredDocuments
for each reviewer in reviewers
for each selected case in batch
```

### 6.3 Input collection dan input element

Dalam Camunda 8, multi-instance biasanya dikonfigurasi dengan collection dan element variable.

Mental model:

```text
inputCollection = requiredAgencies
inputElement    = agency
```

Jika variable:

```json
{
  "requiredAgencies": [
    { "code": "ROM", "mandatory": true },
    { "code": "DCP", "mandatory": true },
    { "code": "TAX", "mandatory": false }
  ]
}
```

Maka setiap instance punya local variable seperti:

```json
{
  "agency": { "code": "ROM", "mandatory": true }
}
```

Prinsip penting:

> Setiap instance harus bekerja dengan local variable miliknya sendiri, bukan saling menulis ke variable global yang sama.

---

## 7. Sequential vs Parallel Multi-instance

### 7.1 Sequential multi-instance

Sequential multi-instance menjalankan satu instance pada satu waktu.

Cocok untuk:

- proses yang harus berurutan;
- external system hanya boleh dipanggil serial;
- hasil item sebelumnya menentukan item berikutnya;
- audit membutuhkan urutan eksplisit;
- rate limit sangat ketat;
- business rule mengharuskan step-by-step review.

Contoh:

```text
For each escalation level:
  Ask Approval
Stop when approved
```

### 7.2 Parallel multi-instance

Parallel multi-instance menjalankan banyak instance bersamaan.

Cocok untuk:

- request opinion ke banyak agency;
- validasi banyak dokumen independen;
- review oleh panel;
- notifikasi ke banyak recipient;
- batch processing kecil/terkontrol.

Risikonya:

- worker spike;
- external API rate limit;
- banyak user task muncul sekaligus;
- race saat menggabungkan result;
- incident massal jika request salah;
- audit menjadi lebih kompleks.

### 7.3 Decision rule

Gunakan sequential jika:

```text
correctness depends on order
or rate limit is strict
or result of previous item affects next item
or human workload must be controlled
```

Gunakan parallel jika:

```text
items are independent
and all/most can be processed concurrently
and downstream systems can tolerate load
and result merge is well-defined
```

---

## 8. Completion Condition: Partial Completion dan Quorum

### 8.1 Masalah all-of-M

Default mental model multi-instance adalah semua instance selesai. Tetapi banyak proses bisnis tidak membutuhkan semua instance.

Contoh:

- approval cukup 2 dari 3 reviewer;
- risk assessment lanjut jika 1 agency memberi objection;
- procurement lanjut jika minimal 3 quotation diterima;
- enforcement escalation aktif jika ada 1 high-risk finding;
- appeal panel selesai jika majority reached.

### 8.2 Completion condition

Completion condition memungkinkan multi-instance body selesai saat kondisi tertentu terpenuhi.

Contoh logika:

```text
approvedCount >= 2
rejectedCount >= 1
mandatoryResponsesReceived = true
responseCount / totalCount >= 0.6
```

Namun, ini bukan sekadar ekspresi teknis. Ini adalah business semantics.

Pertanyaan desain:

1. Jika completion condition terpenuhi, apa yang terjadi pada instance yang masih aktif?
2. Apakah task user yang belum selesai dibatalkan?
3. Apakah external request yang sudah dikirim perlu diabaikan jika response datang terlambat?
4. Apakah audit harus mencatat bahwa branch lain tidak lagi diperlukan?
5. Apakah outcome bisa berubah jika response terlambat datang?

### 8.3 Quorum approval pattern

Contoh requirement:

```text
A case requires approval from 3 senior officers.
The process may continue if 2 approve.
If 2 reject, process is rejected.
If timeout occurs, escalate to manager.
```

Model konseptual:

```text
Multi-instance User Task: Senior Officer Review
  inputCollection = reviewers
  completionCondition = approvedCount >= 2 or rejectedCount >= 2

After MI:
  if approvedCount >= 2 -> Continue
  if rejectedCount >= 2 -> Reject
  else -> Escalate
```

Tetapi implementasi harus memperhatikan bahwa `approvedCount`/`rejectedCount` tidak boleh menjadi variable global yang di-update secara race-prone oleh banyak task completion.

Strategi aman:

- tiap review menulis result per reviewer;
- result disimpan sebagai item immutable;
- aggregation dilakukan oleh satu worker setelah MI selesai;
- atau gunakan command table di DB dengan optimistic locking;
- jangan beberapa worker menulis `approvedCount = approvedCount + 1` tanpa lock.

---

## 9. Race Condition pada Process Variables

### 9.1 Race paling umum

Misalkan ada parallel multi-instance reviewer task. Setiap completion menulis:

```json
{
  "approvedCount": 1
}
```

Atau worker melakukan:

```java
int approvedCount = variables.getApprovedCount();
approvedCount++;
completeJob(Map.of("approvedCount", approvedCount));
```

Jika dua branch selesai hampir bersamaan, keduanya bisa membaca nilai lama `0`, lalu sama-sama menulis `1`. Hasil benar harusnya `2`, tetapi variable akhir menjadi `1`.

Ini classic lost update.

### 9.2 Prinsip variable parallel-safe

Untuk parallel branch:

- jangan update counter global secara langsung dari banyak branch;
- jangan append array global dari banyak branch tanpa desain;
- jangan overwrite object global dari banyak branch;
- jangan menganggap order output deterministic;
- gunakan local variable per instance;
- lakukan aggregation di satu titik setelah join;
- simpan result detail per item dengan id unik.

### 9.3 Pattern aman: per-item result

Alih-alih:

```json
{
  "approvedCount": 2
}
```

Gunakan:

```json
{
  "reviewResults": [
    { "reviewerId": "u1001", "decision": "APPROVED", "decidedAt": "2026-06-17T09:00:00+07:00" },
    { "reviewerId": "u1002", "decision": "REJECTED", "decidedAt": "2026-06-17T09:03:00+07:00" }
  ]
}
```

Atau lebih aman lagi, simpan di domain DB:

```text
CASE_REVIEW_DECISION
- case_id
- reviewer_id
- decision
- reason
- decided_at
- task_id
- process_instance_key
- unique(case_id, reviewer_id)
```

Lalu aggregation worker membaca table tersebut dan menghasilkan decision summary.

---

## 10. Fan-out/Fan-in Pattern

### 10.1 Apa itu fan-out/fan-in

Fan-out/fan-in adalah pattern:

```text
1 process step
  -> many parallel work items
  -> collect results
  -> decide next step
```

Contoh:

```text
Screen Application
  -> Fan out validation to N rules/services/agencies
  -> Fan in validation results
  -> Determine application completeness
```

### 10.2 Fan-out stage

Fan-out perlu menjawab:

1. berapa item yang dibuat?
2. dari mana item berasal?
3. apakah item immutable selama proses berjalan?
4. apakah item bisa ditambah/dihapus saat fan-out sudah berjalan?
5. apakah setiap item punya id stabil?
6. apakah setiap item punya retry policy sendiri?
7. apakah setiap item punya timeout sendiri?

### 10.3 Work stage

Setiap item harus punya:

- item id;
- correlation id;
- owner;
- status;
- started time;
- completed time;
- result;
- error;
- retry count;
- audit trail.

### 10.4 Fan-in stage

Fan-in bukan hanya join teknis. Fan-in adalah business aggregation.

Pertanyaan:

1. Apakah semua result wajib?
2. Apakah optional result boleh absen?
3. Apakah rejected result langsung menghentikan proses?
4. Apakah timeout dianggap reject, no response, atau escalate?
5. Apakah late result diterima?
6. Apakah aggregation deterministic?
7. Apakah aggregation bisa diulang tanpa mengubah outcome?

### 10.5 Fan-in worker

Pattern aman:

```text
Parallel branches produce immutable result rows.
Join waits until process semantics satisfied.
One aggregation worker calculates final summary.
Summary becomes input to next gateway.
```

Aggregation worker harus idempotent.

Pseudo-code:

```java
public AssessmentSummary aggregate(String caseId) {
    List<Result> results = resultRepository.findByCaseId(caseId);

    boolean hasBlockingObjection = results.stream()
        .anyMatch(r -> r.outcome() == Outcome.BLOCKING_OBJECTION);

    boolean allMandatoryReceived = requiredItems.stream()
        .filter(RequiredItem::mandatory)
        .allMatch(item -> results.stream().anyMatch(r -> r.itemId().equals(item.id())));

    if (hasBlockingObjection) {
        return AssessmentSummary.rejected("BLOCKING_OBJECTION");
    }

    if (!allMandatoryReceived) {
        return AssessmentSummary.incomplete("MANDATORY_RESPONSE_MISSING");
    }

    return AssessmentSummary.passed();
}
```

---

## 11. N-of-M Approval Pattern

### 11.1 Requirement shape

N-of-M berarti proses tidak harus menunggu semua approver.

Contoh:

```text
Butuh 2 approval dari 3 reviewer.
Kalau 2 reject, langsung reject.
Kalau timeout sebelum quorum, escalate.
```

### 11.2 BPMN options

Ada beberapa opsi modeling:

#### Option A — Parallel multi-instance + completion condition

Cocok jika engine semantics dan variable aggregation cukup aman.

```text
Multi-instance Review Task
  completionCondition = approved >= 2 or rejected >= 2
```

Risiko:

- race update counter;
- cancellation task yang belum selesai harus jelas;
- late user action harus ditolak;
- audit harus mencatat review yang tidak lagi diperlukan.

#### Option B — Review tasks stored in domain DB + aggregation worker

BPMN mengorkestrasi fase review, sedangkan detail voting disimpan di domain DB.

```text
Create Review Assignments
Wait for Reviews / Timer / Message
Evaluate Quorum
```

Cocok untuk regulatory/case management yang butuh audit kuat.

#### Option C — Explicit branches untuk fixed reviewer kecil

Jika reviewer selalu fixed dan sedikit:

```text
Reviewer A
Reviewer B
Reviewer C
Join/Evaluate
```

Lebih mudah dibaca, tetapi tidak scalable untuk reviewer dinamis.

### 11.3 Recommended pattern untuk enterprise/regulatory

Untuk sistem regulatory, pattern terbaik biasanya:

```text
BPMN manages phase and SLA.
Domain DB manages individual review records.
Aggregation worker determines quorum based on durable review table.
BPMN continues based on summary outcome.
```

Alasannya:

- audit lebih kuat;
- UI lebih fleksibel;
- partial decision lebih mudah dijelaskan;
- late submission lebih mudah ditolak;
- manual repair lebih aman;
- versioning lebih mudah.

---

## 12. Mandatory vs Optional Branch

Banyak proses review memiliki mandatory dan optional reviewer/agency.

Contoh:

```json
{
  "agencies": [
    { "code": "ROM", "mandatory": true },
    { "code": "DCP", "mandatory": true },
    { "code": "TAX", "mandatory": false }
  ]
}
```

Business rule:

```text
All mandatory responses must be received.
Optional responses are considered if received before deadline.
If optional response is late, ignore for current decision but record as late.
```

Modeling:

```text
Send Requests to All Agencies
Wait until:
  - all mandatory received, or
  - deadline reached
Evaluate Results
```

Jangan paksa parallel join menunggu optional response kalau business tidak butuh. Itu membuat proses stuck karena dependency optional.

---

## 13. Parallelism dan External API Rate Limit

Parallel multi-instance bisa meledakkan traffic.

Contoh:

```text
1,000 process instances per hour
x 10 agencies per process
= 10,000 external calls per hour
```

Jika semua process fan-out bersamaan, external API bisa terkena spike.

### 13.1 Control points

Rate limit bisa dikontrol di beberapa level:

1. BPMN model:
   - sequential MI;
   - batch chunking;
   - timer spacing;
   - intermediate queue step.
2. Worker configuration:
   - max jobs active;
   - thread pool size;
   - worker instances;
   - job timeout;
   - fetch variables minimal.
3. Application layer:
   - token bucket;
   - semaphore;
   - circuit breaker;
   - bulkhead;
   - retry budget.
4. Infrastructure:
   - HPA limit;
   - pod disruption policy;
   - queue buffer;
   - API gateway throttling.

### 13.2 Anti-pattern

```text
Parallel MI over 500 items
Each item calls same external API
Worker scaled to 20 pods
Each pod maxJobsActive = 100
No rate limiter
```

Maksimum concurrency potensial:

```text
20 pods * 100 jobs = 2,000 active jobs
```

Kalau external API hanya mengizinkan 300/minute, sistem akan self-DDoS.

### 13.3 Worker-side limiter

Java pattern:

```java
public final class ExternalApiLimiter {
    private final Semaphore permits = new Semaphore(20);

    public <T> T execute(Supplier<T> call) {
        boolean acquired = false;
        try {
            permits.acquire();
            acquired = true;
            return call.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("Interrupted while waiting for rate-limit permit", e);
        } finally {
            if (acquired) {
                permits.release();
            }
        }
    }
}
```

Untuk distributed rate limit lintas pod, gunakan Redis/token bucket atau dedicated rate limiter.

---

## 14. Worker Concurrency vs Process Concurrency

Ada dua jenis concurrency:

1. **Process concurrency**: berapa banyak branch/task aktif di BPMN.
2. **Worker concurrency**: berapa banyak job yang dapat dikerjakan aplikasi Java bersamaan.

Keduanya berbeda.

```text
BPMN can create 10,000 jobs.
Worker may only process 50 at a time.
```

Ini normal dan sering diinginkan.

### 14.1 Tuning mental model

Parameter penting:

- jumlah worker pod;
- `maxJobsActive` per worker;
- thread pool size;
- job timeout;
- external API timeout;
- retry backoff;
- average job duration;
- failure rate;
- external dependency capacity.

### 14.2 Simple capacity formula

Jika:

```text
workerPods = 5
maxConcurrentPerPod = 20
avgJobDuration = 2 seconds
```

Maka perkiraan throughput maksimal:

```text
5 * 20 / 2 = 50 jobs/sec
```

Tetapi throughput aman harus dikurangi oleh:

- network latency;
- external API limit;
- DB connection pool;
- retry storm;
- serialization overhead;
- CPU/memory;
- logging overhead.

---

## 15. Backpressure: Jangan Menang di BPMN Tapi Kalah di Runtime

Backpressure adalah kemampuan sistem menahan laju input agar downstream tidak kolaps.

Dalam workflow system, backpressure bisa muncul di:

- engine;
- gateway;
- job activation;
- worker thread pool;
- database;
- external API;
- UI task backlog;
- message broker;
- exporter/read model.

### 15.1 Tanda tidak ada backpressure

- incidents meningkat massal;
- job timeout meningkat;
- duplicate execution meningkat;
- external API 429/503 meningkat;
- task backlog meledak;
- DB connection pool exhausted;
- pod CPU tinggi tetapi throughput turun;
- retry storm.

### 15.2 Backpressure design

Untuk desain top 1%:

```text
BPMN defines business concurrency.
Worker controls technical concurrency.
Rate limiter controls external capacity.
Retry budget prevents storm.
Monitoring detects saturation.
Manual control can pause/scale/reduce load.
```

---

## 16. Inclusive Gateway: Powerful Tapi Mudah Membingungkan

Inclusive gateway memilih satu atau lebih outgoing flow berdasarkan kondisi.

Contoh:

```text
if requiresPaymentCheck -> Payment Check
if requiresDocumentCheck -> Document Check
if requiresRiskCheck -> Risk Check
```

Join inclusive gateway harus memahami branch mana yang aktif. Ini lebih kompleks daripada parallel join.

Risiko:

- kondisi tidak mutually clear;
- branch optional tidak terdokumentasi;
- join behavior sulit dipahami engineer baru;
- migration lebih berisiko;
- test path meledak.

Gunakan inclusive gateway jika memang branch yang diaktifkan bersifat data-driven dan jumlah branch kecil/statis.

Jika branch dinamis banyak, gunakan multi-instance.

---

## 17. Event-based Race: Siapa yang Terjadi Duluan?

Kadang requirement bukan “jalankan semua”, tetapi “tunggu salah satu event”.

Contoh:

```text
Wait for agency response
or wait for timeout
or wait for cancellation request
```

Ini bukan parallel gateway biasa. Ini race event.

Pattern:

```text
Event-based Gateway
  -> Message: Agency Response
  -> Timer: Response Deadline
  -> Message: Applicant Withdraws
```

Semantik:

- event yang pertama terjadi menentukan jalur;
- event lain tidak lagi relevan di scope tersebut;
- late message harus ditangani dengan jelas.

Pertanyaan penting:

1. Apakah late response diabaikan?
2. Apakah late response dicatat?
3. Apakah late response bisa reopen case?
4. Apakah timeout membatalkan request external?
5. Apakah cancellation bisa interrupt seluruh subprocess?

---

## 18. Parallel User Tasks dan Human Concurrency

Parallelism tidak hanya soal service task. User task paralel lebih berbahaya karena manusia bisa membuat keputusan yang saling bertentangan.

Contoh:

```text
Officer A reviews applicant eligibility.
Officer B reviews financial document.
Officer C reviews compliance history.
```

Risiko:

- A approves sementara B rejects;
- C requests more info setelah A already approves;
- manager overrides before all reviews done;
- user completes stale task after process moved on;
- reassignment creates duplicate responsibility.

### 18.1 Human concurrency guard

Butuh guard di UI/backend:

- task must still be active;
- task must belong to current user or group;
- case version must match;
- process phase must allow completion;
- stale form submission rejected;
- business lock/optimistic lock checked;
- decision reason required;
- audit snapshot stored.

Backend completion harus melakukan:

```text
validate task active
validate authorization
validate domain state
persist decision atomically
complete task / correlate result
record audit
```

---

## 19. Parallel Branch Failure Strategy

Jika satu branch gagal, apa yang terjadi pada branch lain?

Ada beberapa strategy:

### 19.1 Independent failure

Branch gagal menjadi incident, branch lain tetap jalan.

Cocok untuk:

- branch independen;
- failure dapat diperbaiki tanpa membatalkan proses;
- all branches still needed.

### 19.2 Fail-fast

Satu branch gagal secara bisnis, seluruh subprocess dihentikan.

Contoh:

```text
If identity verification returns FRAUD, stop all other checks.
```

Gunakan:

- BPMN error;
- interrupting boundary event;
- terminate end event dalam scope yang tepat;
- event subprocess.

### 19.3 Degrade and continue

Branch gagal, tetapi proses lanjut dengan status degraded.

Contoh:

```text
Optional enrichment service unavailable.
Continue manual review.
```

### 19.4 Escalate

Branch gagal/timeout dan butuh manusia.

```text
External agency not responding.
Create manual follow-up task.
```

### 19.5 Compensation

Branch sudah melakukan side effect, lalu proses keseluruhan gagal.

```text
Payment reserved.
Document issued.
Notification sent.
Later validation rejects case.
```

Butuh compensation action.

---

## 20. Cancellation Semantics

Parallel process harus punya cancellation semantics.

Contoh:

```text
Applicant withdraws application while 3 agency reviews are active.
```

Apa yang harus terjadi?

- user tasks agency review dibatalkan;
- pending external requests ditandai obsolete;
- late response ditolak/diarsip;
- SLA timer dihentikan;
- audit mencatat withdrawal;
- case status berubah ke withdrawn;
- notification dikirim.

Jangan hanya cancel process instance tanpa domain cleanup. BPMN cancellation harus sinkron dengan domain state.

---

## 21. Data Merge Pattern

### 21.1 Bad merge

```text
Each branch writes variable `result`.
Last completed branch wins.
```

Ini buruk karena:

- hasil non-deterministic;
- audit sulit;
- branch lambat bisa overwrite branch cepat;
- manual repair sulit.

### 21.2 Better merge

```text
Each branch writes `result_<branchName>`.
```

Contoh:

```json
{
  "identityCheckResult": "PASSED",
  "paymentCheckResult": "PASSED",
  "documentCheckResult": "FAILED"
}
```

Cukup untuk branch statis kecil.

### 21.3 Best merge untuk dynamic branch

```text
Each item writes immutable row with item id.
Aggregation worker creates summary.
```

DB:

```sql
create table process_branch_result (
    id varchar2(64) primary key,
    process_instance_key varchar2(64) not null,
    business_key varchar2(128) not null,
    branch_type varchar2(64) not null,
    branch_item_id varchar2(128) not null,
    outcome varchar2(64) not null,
    payload clob,
    created_at timestamp not null,
    unique (business_key, branch_type, branch_item_id)
);
```

---

## 22. Idempotency in Parallel Branches

Parallel branch memperbesar peluang duplicate execution.

Idempotency key harus cukup spesifik.

Contoh buruk:

```text
businessKey = CASE-1001
```

Jika semua branch memakai idempotency key yang sama, mereka saling dianggap duplicate.

Contoh lebih baik:

```text
CASE-1001:AGENCY_REQUEST:ROM
CASE-1001:AGENCY_REQUEST:DCP
CASE-1001:DOC_CHECK:PASSPORT
CASE-1001:DOC_CHECK:FINANCIAL_STATEMENT
```

Formula:

```text
idempotencyKey = businessKey + ':' + activityType + ':' + itemId
```

Untuk job tertentu:

```text
idempotencyKey = businessKey + ':' + elementId + ':' + elementInstanceKey
```

Pilih sesuai side effect.

---

## 23. Optimistic Locking dan Domain State

Saat parallel branch menulis domain DB yang sama, gunakan optimistic locking.

Contoh:

```sql
alter table case_assessment add version number not null;
```

Update:

```sql
update case_assessment
set status = ?, version = version + 1
where case_id = ? and version = ?;
```

Jika affected rows = 0, berarti ada concurrent update.

Di Java:

```java
public void updateAssessment(String caseId, long expectedVersion, AssessmentUpdate update) {
    int rows = repository.updateIfVersionMatches(caseId, expectedVersion, update);
    if (rows == 0) {
        throw new ConcurrentModificationException("Case was modified concurrently: " + caseId);
    }
}
```

Dalam worker, concurrent modification biasanya bukan BPMN business error. Ia technical/concurrency failure yang bisa di-retry dengan backoff, kecuali menandakan stale command.

---

## 24. Parallelism dan Transaction Boundary

Camunda 8 worker tidak berada dalam satu local ACID transaction dengan engine.

Worker flow biasanya:

```text
activate job
perform DB/API side effect
complete job
```

Failure windows:

1. DB commit sukses, complete job gagal.
2. External API sukses, complete job gagal.
3. Complete job sukses, response ke worker timeout.
4. Worker crash setelah side effect sebelum complete.
5. Job timeout dan worker lain mengulang.

Dengan parallel branch, failure window ini terjadi di banyak branch sekaligus.

Solusi:

- idempotency;
- outbox;
- inbox;
- command table;
- side-effect log;
- retry-safe completion;
- audit-safe repair.

---

## 25. Designing Fan-out with Outbox

Misalkan proses perlu mengirim request ke banyak agency.

Jangan langsung memanggil semua API dari BPMN branch tanpa control.

Pattern:

```text
BPMN: Prepare Agency Requests
Worker:
  - create agency_request rows
  - create outbox rows
  - complete job
Outbox publisher:
  - sends request to agencies
  - marks sent
Inbound router:
  - receives response
  - stores response
  - correlates message to process
BPMN:
  - waits/evaluates responses
```

Keuntungan:

- durable request list;
- retry publish aman;
- late response bisa di-handle;
- audit jelas;
- process tidak bergantung pada synchronous external API;
- rate limit bisa diterapkan di publisher.

---

## 26. Dynamic Parallelism dengan Chunking

Jika collection besar, jangan selalu buat multi-instance ribuan item sekaligus.

Contoh:

```text
10,000 documents to classify
```

Parallel MI langsung bisa menciptakan terlalu banyak job.

Gunakan chunking:

```text
Split into chunks of 100
Process chunk sequentially or limited parallel
Aggregate chunk result
Continue next chunk
```

Pseudo:

```text
Prepare Chunks
For each chunk sequentially:
  Parallel process items in chunk
  Aggregate chunk
Aggregate all chunks
```

Atau gunakan worker internal batching jika BPMN tidak perlu melihat setiap item sebagai aktivitas audit terpisah.

Rule:

> Model item sebagai BPMN branch hanya jika item tersebut punya business significance, audit significance, SLA significance, atau independent repair significance.

Kalau hanya technical batch item, jangan over-model di BPMN.

---

## 27. Parallelism dan Audit

Audit untuk parallel workflow harus bisa menjawab:

1. branch apa saja yang dibuat?
2. kapan branch dibuat?
3. siapa/apa yang mengerjakan branch?
4. input apa yang dipakai branch?
5. output apa yang dihasilkan branch?
6. branch mana yang gagal?
7. branch mana yang dibatalkan?
8. branch mana yang terlambat?
9. branch mana yang diabaikan karena quorum sudah tercapai?
10. bagaimana final decision dihitung dari branch result?

Untuk regulatory system, final decision tidak cukup mencatat:

```text
Application approved.
```

Harus bisa menjelaskan:

```text
Application approved because:
- identity check passed
- mandatory agency ROM responded no objection
- mandatory agency DCP responded no objection
- optional TAX response not received before deadline and was not required
- payment confirmed
- document completeness passed
- quorum rule satisfied at 2026-06-17T10:00+07:00
```

---

## 28. Observability untuk Parallel Workflow

Metrics penting:

- active branch count per process;
- active multi-instance count;
- branch duration histogram;
- slowest branch;
- timeout count;
- cancellation count;
- late response count;
- partial completion count;
- incident count by branch type;
- retry count by branch type;
- external API 429/503;
- worker concurrency utilization;
- task backlog per group;
- fan-in waiting time.

Log field penting:

```text
businessKey
processInstanceKey
elementId
elementInstanceKey
jobKey
branchType
branchItemId
workerId
correlationId
idempotencyKey
attempt
outcome
```

Tanpa field ini, debugging parallel process akan sangat sulit.

---

## 29. Testing Parallel Workflow

Parallel process tidak cukup diuji happy path.

Test scenarios:

1. semua branch sukses;
2. satu branch gagal teknis lalu retry sukses;
3. satu branch retry habis menjadi incident;
4. branch mandatory timeout;
5. branch optional timeout;
6. branch response terlambat;
7. duplicate response;
8. duplicate job execution;
9. two reviewers complete simultaneously;
10. quorum reached before all complete;
11. branch cancelled after process withdrawal;
12. process migration saat menunggu parallel join;
13. aggregation worker dijalankan dua kali;
14. DB optimistic lock conflict;
15. external API 429 storm;
16. worker crash setelah side effect.

### 29.1 Deterministic test principle

Jangan mengandalkan sleep panjang.

Gunakan:

- fake clock jika tersedia;
- controllable mock external system;
- deterministic inbound events;
- DB assertions;
- process instance state assertions;
- idempotency table assertions;
- audit row assertions.

---

## 30. Worked Example: Multi-agency Regulatory Review

### 30.1 Requirement

Sebuah application harus direview oleh beberapa agency.

Rules:

1. ROM dan DCP mandatory.
2. TAX optional.
3. Jika mandatory agency memberi objection, application masuk manual senior review.
4. Jika semua mandatory agency no objection, application lanjut.
5. Jika mandatory agency tidak respond dalam 5 working days, escalate.
6. Optional agency response hanya dipakai jika datang sebelum deadline.
7. Late response dicatat tetapi tidak mengubah outcome kecuali case belum finalized.

### 30.2 Bad BPMN

```text
Parallel Gateway
  -> Wait ROM Response
  -> Wait DCP Response
  -> Wait TAX Response
Parallel Join
Evaluate
```

Masalah:

- TAX optional tetapi join menunggu TAX;
- mandatory timeout tidak jelas;
- late response tidak jelas;
- response race tidak jelas;
- audit optional handling tidak jelas.

### 30.3 Better BPMN

```text
Prepare Agency Requests
Send Agency Requests
Wait for Mandatory Responses or Deadline
Evaluate Mandatory Responses
  -> if objection: Senior Manual Review
  -> if missing mandatory: Escalate Missing Response
  -> if no objection: Continue Assessment
Record Optional Responses if Available
```

TAX optional bisa menjadi parallel/non-interrupting path atau disimpan sebagai inbound response yang dievaluasi jika tersedia.

### 30.4 Data model

```sql
agency_request
- id
- case_id
- agency_code
- mandatory_flag
- status
- sent_at
- due_at
- completed_at
- obsolete_flag
- version

agency_response
- id
- request_id
- case_id
- agency_code
- response_code
- response_payload
- received_at
- late_flag
- duplicate_flag
- correlation_id
```

### 30.5 Aggregation logic

```java
public AgencyReviewSummary evaluate(String caseId) {
    List<AgencyRequest> requests = requestRepository.findByCaseId(caseId);
    List<AgencyResponse> responses = responseRepository.findAcceptedByCaseId(caseId);

    List<AgencyRequest> mandatory = requests.stream()
        .filter(AgencyRequest::mandatory)
        .toList();

    boolean missingMandatory = mandatory.stream()
        .anyMatch(req -> responses.stream().noneMatch(res -> res.matches(req)));

    boolean hasObjection = responses.stream()
        .filter(res -> mandatory.stream().anyMatch(req -> res.matches(req)))
        .anyMatch(AgencyResponse::isObjection);

    if (missingMandatory) {
        return AgencyReviewSummary.escalate("MANDATORY_RESPONSE_MISSING");
    }

    if (hasObjection) {
        return AgencyReviewSummary.manualReview("MANDATORY_AGENCY_OBJECTION");
    }

    return AgencyReviewSummary.pass();
}
```

### 30.6 Why this is better

- mandatory/optional semantics explicit;
- timeout behavior explicit;
- late response behavior explicit;
- audit stronger;
- manual repair easier;
- process not stuck waiting optional branch;
- aggregation deterministic.

---

## 31. Worked Example: Parallel Document Validation

### 31.1 Requirement

Applicant uploads multiple documents. Each document must be checked.

Rules:

1. All mandatory documents must pass.
2. Optional documents may fail without blocking.
3. Fraud indicator in any document blocks process.
4. OCR service has rate limit 100/minute.
5. Validation result must be auditable per document.

### 31.2 Modeling option

```text
Prepare Document Validation Items
Parallel Multi-instance: Validate Document
Aggregate Document Results
Gateway:
  if fraud -> Reject/Escalate Fraud
  if mandatory missing/failed -> Request Resubmission
  else -> Continue
```

### 31.3 Worker design

Each validation job uses:

```text
idempotencyKey = caseId + ':DOC_VALIDATION:' + documentId
```

Worker:

1. reads document metadata;
2. checks idempotency table;
3. calls OCR with rate limiter;
4. persists document validation result;
5. completes job with small result reference;
6. aggregation worker builds summary.

### 31.4 Avoid

Do not put full OCR text in process variables unless required and safe. Store document result in domain DB/object storage and keep reference in process variable.

---

## 32. Java Pattern: Safe Branch Result Recording

```java
public final class BranchResultService {
    private final BranchResultRepository repository;

    public BranchResultService(BranchResultRepository repository) {
        this.repository = repository;
    }

    public BranchResult recordOnce(BranchResultCommand command) {
        return repository.findByUniqueKey(command.uniqueKey())
            .orElseGet(() -> repository.insert(command.toResult()));
    }
}
```

Where unique key is:

```text
businessKey + branchType + branchItemId
```

This makes duplicate job execution safe.

---

## 33. Java Pattern: Aggregation as Pure Function

The aggregation logic should be as close as possible to a pure function:

```java
public final class ReviewAggregator {
    public ReviewOutcome aggregate(ReviewInput input) {
        if (input.hasBlockingObjection()) {
            return ReviewOutcome.manualReview("BLOCKING_OBJECTION");
        }

        if (!input.allMandatoryCompleted()) {
            return ReviewOutcome.escalate("MANDATORY_RESPONSE_MISSING");
        }

        if (input.hasMandatoryRejection()) {
            return ReviewOutcome.reject("MANDATORY_REJECTION");
        }

        return ReviewOutcome.pass();
    }
}
```

Why pure?

- easier to test;
- deterministic;
- replayable;
- explainable;
- audit-friendly;
- less coupled to engine.

---

## 34. BPMN Design Checklist untuk Parallelism

Sebelum memakai parallel gateway atau multi-instance, jawab:

### Business semantics

- Apakah semua branch wajib?
- Apakah branch optional?
- Apakah cukup N dari M?
- Apa yang terjadi jika satu branch reject?
- Apa yang terjadi jika satu branch timeout?
- Apa yang terjadi jika response terlambat?
- Apa yang terjadi jika process dibatalkan?

### Data semantics

- Apa input per branch?
- Apa output per branch?
- Apakah output immutable?
- Bagaimana result digabung?
- Siapa owner aggregate decision?
- Apakah branch menulis variable global?

### Runtime semantics

- Berapa maksimum branch aktif?
- Apakah external system kuat menerima fan-out?
- Apakah perlu rate limiter?
- Apakah job timeout sesuai durasi kerja?
- Apakah retry bisa menyebabkan storm?
- Apakah worker idempotent?

### Human workflow

- Apakah user task bisa stale?
- Apakah user boleh complete setelah quorum tercapai?
- Apakah reassignment aman?
- Apakah maker-checker perlu dicek?
- Apakah task cancellation diaudit?

### Operations

- Bagaimana mendeteksi branch stuck?
- Bagaimana repair satu branch?
- Bagaimana cancel branch?
- Bagaimana retry branch?
- Bagaimana menjelaskan final decision?
- Dashboard apa yang dibutuhkan?

---

## 35. Anti-patterns

### 35.1 Parallel gateway sebagai performance hack

```text
“Biar cepat, semua dibuat parallel.”
```

Ini sering menghasilkan race, rate limit failure, dan audit chaos.

### 35.2 Multi-instance untuk technical loop besar

Jika 100,000 item tidak punya business visibility, jangan jadikan 100,000 BPMN activity instances. Gunakan batch worker.

### 35.3 Global counter update dari banyak branch

```text
approvedCount++
```

Race-prone.

### 35.4 Last writer wins variable

```text
result = ...
```

di banyak branch.

### 35.5 Join menunggu optional work

Optional branch membuat process stuck.

### 35.6 No cancellation policy

Process withdrawn tetapi parallel tasks masih bisa completed.

### 35.7 No late event policy

External response datang setelah timeout dan sistem tidak tahu harus diapakan.

### 35.8 No rate limiter

Parallel process menyerang external dependency.

---

## 36. Top 1% Mental Model

Paralelisme BPMN bukan tentang membuat proses “lebih cepat”. Ia tentang membuat **multiple independent obligations** berjalan dalam satu business process sambil menjaga correctness.

Top engineer melihat parallelism sebagai kombinasi dari:

```text
business semantics
+ token semantics
+ data ownership
+ concurrency control
+ idempotency
+ rate limiting
+ failure isolation
+ audit explainability
+ operational repair
```

Jika satu saja hilang, diagram bisa terlihat indah tetapi production menjadi rapuh.

Prinsip akhir:

1. Parallelism harus punya business reason.
2. Fan-out harus bounded.
3. Fan-in harus deterministic.
4. Branch result harus immutable atau concurrency-safe.
5. Optional branch tidak boleh memblokir mandatory process.
6. Quorum harus explicit.
7. Late event harus punya policy.
8. Worker harus idempotent.
9. External dependency harus dilindungi rate limit.
10. Final decision harus bisa dijelaskan ulang ke auditor.

---

## 37. Ringkasan

Di part ini kita mempelajari:

- parallel gateway sebagai AND split/join;
- multi-instance sequential dan parallel;
- perbedaan parallel gateway vs multi-instance;
- completion condition dan quorum;
- fan-out/fan-in design;
- mandatory vs optional branch;
- race condition process variable;
- safe result aggregation;
- worker concurrency vs process concurrency;
- backpressure dan rate limiting;
- parallel human workflow;
- cancellation dan late event handling;
- idempotency key untuk branch;
- optimistic locking;
- testing parallel workflows;
- worked example regulatory multi-agency review dan document validation.

Part ini menjadi fondasi untuk memahami **process composition**, **saga**, dan **large-scale workflow reliability** di bagian berikutnya.

---

## 38. Referensi

- Camunda 8 Documentation — Multi-instance: https://docs.camunda.io/docs/components/modeler/bpmn/multi-instance/
- Camunda 8 Documentation — Parallel gateway: https://docs.camunda.io/docs/components/modeler/bpmn/parallel-gateways/
- Camunda 8 Documentation — Variables: https://docs.camunda.io/docs/components/concepts/variables/
- Camunda 8 Documentation — Job workers: https://docs.camunda.io/docs/components/concepts/job-workers/
- Camunda 8 Documentation — Java Client Job Worker: https://docs.camunda.io/docs/apis-tools/java-client/job-worker/
- Camunda 8 Documentation — Workflow patterns: https://docs.camunda.io/docs/components/concepts/workflow-patterns/
- Camunda 8 Documentation — Gateways overview: https://docs.camunda.io/docs/components/modeler/bpmn/gateways/

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 13 — Timers, SLA, Timeout, Expiry, and Scheduled Process Behavior](./learn-java-bpmn-camunda-part-13-timers-sla-timeout-expiry-scheduled-process-behavior.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 15 — Subprocess, Call Activity, Reusable Process, and Process Composition](./learn-java-bpmn-camunda-part-15-subprocess-call-activity-reusable-process-composition.md)
