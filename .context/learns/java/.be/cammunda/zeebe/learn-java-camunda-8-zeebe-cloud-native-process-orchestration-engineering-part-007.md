# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-007.md

# Part 007 — Worker Correctness: Idempotency, Retries, Duplicate Execution, and External Side Effects

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Level: Advanced / Staff+ Engineering  
> Fokus: Java 8 hingga Java 25, Camunda 8 / Zeebe, distributed workflow correctness  
> Status seri: **belum selesai**. Ini adalah Part 007 dari rangkaian besar sampai Part 035.

---

## 0. Posisi Part Ini Dalam Seri

Part sebelumnya membahas bagaimana membangun **Java job worker** yang production-grade: lifecycle, concurrency, timeout, worker configuration, graceful shutdown, dan observability.

Part ini membahas sesuatu yang lebih fundamental: **benar atau tidaknya efek bisnis yang dihasilkan worker**.

Di production, worker yang “jalan” belum tentu benar. Worker bisa:

- mengeksekusi job dua kali,
- memanggil external API dua kali,
- menyimpan data dua kali,
- mengirim email dua kali,
- mengurangi saldo dua kali,
- membuat case enforcement ganda,
- menyelesaikan job padahal side effect belum konsisten,
- gagal complete job setelah business action berhasil,
- retry terus untuk error yang tidak akan sembuh,
- menciptakan incident yang tidak bisa dipahami tim support.

Camunda 8 / Zeebe memberi durable orchestration, retry mechanism, incident handling, dan job activation. Tetapi engine **tidak bisa otomatis membuat business side effect Anda menjadi exactly-once**. Itu adalah tanggung jawab desain aplikasi worker.

Kalimat kunci part ini:

> Zeebe mengorkestrasi state proses secara durable, tetapi efek bisnis eksternal tetap harus didesain idempotent, retry-safe, observable, dan recoverable oleh Java worker serta sistem domain di sekitarnya.

---

## 1. Core Problem: Worker Bukan Function Call Biasa

Banyak engineer baru Camunda 8 secara tidak sadar memperlakukan service task seperti function call:

```text
BPMN service task -> Java method -> return result -> process continues
```

Mental model itu terlalu sederhana dan berbahaya.

Model yang lebih benar:

```text
Process instance reaches service task
        |
        v
Zeebe creates a durable job
        |
        v
A worker leases/activates the job for a limited time
        |
        v
Worker executes business logic outside the engine
        |
        v
Worker sends command: complete / fail / throw BPMN error
        |
        v
Zeebe accepts or rejects the command depending on current job state
```

Perhatikan beberapa konsekuensi:

1. Worker berjalan **di luar broker**.
2. Worker bisa crash setelah melakukan side effect.
3. Network bisa putus setelah side effect berhasil tetapi sebelum job completed.
4. Job activation punya timeout.
5. Jika job tidak completed/fail dalam timeout, job bisa diambil worker lain.
6. Complete command bisa ditolak karena job sudah timeout, canceled, atau completed oleh worker lain.
7. Retry engine hanya tahu job gagal, bukan apakah side effect eksternal sudah sebagian berhasil.

Jadi correctness worker tidak bisa hanya dilihat dari kode handler. Correctness harus dilihat dari gabungan:

- Zeebe job lifecycle,
- worker timeout,
- retry count,
- idempotency key,
- external system contract,
- local database transaction,
- deduplication store,
- observability,
- human repair flow.

---

## 2. At-Least-Once: Fakta Dasar Yang Tidak Boleh Dilawan

Dalam sistem distributed orchestration, pola aman adalah mengasumsikan bahwa job handler **dapat dieksekusi lebih dari sekali**.

Secara praktis, duplicate execution dapat terjadi karena:

1. Worker mengambil job.
2. Worker menjalankan external call.
3. External call sukses.
4. Worker crash sebelum complete job.
5. Job timeout.
6. Zeebe membuat job available lagi.
7. Worker lain mengambil job yang sama.
8. Business action dapat dijalankan ulang.

Atau:

1. Worker menjalankan action.
2. Worker mengirim complete command.
3. Command sebenarnya diterima engine.
4. Response ke worker gagal karena network timeout.
5. Worker tidak yakin complete sukses.
6. Sistem retry di sisi client/aplikasi dapat mencoba lagi.
7. Complete kedua dapat ditolak karena job sudah tidak ada/selesai.

Dalam dua skenario tersebut, pertanyaan pentingnya bukan “bagaimana mencegah semua duplicate execution?” karena itu tidak realistis di distributed system. Pertanyaan yang benar:

> Bagaimana mendesain worker agar eksekusi ulang tidak merusak state bisnis?

Itulah idempotency.

---

## 3. Exactly-Once Adalah Ilusi Jika Ada External Side Effect

Sering muncul klaim:

> “Saya ingin worker exactly once.”

Klaim ini perlu dibedah.

### 3.1 Exactly-once di mana?

Ada beberapa lapisan berbeda:

| Lapisan | Bisa exactly-once? | Catatan |
|---|---:|---|
| Zeebe internal state transition | Engine menjaga konsistensi internal sesuai log/partition semantics | Ini bukan berarti external side effect exactly-once |
| Job delivery ke worker | Praktis harus dianggap at-least-once | Worker dapat menerima job yang sama lebih dari sekali |
| External HTTP API | Tergantung API | Biasanya perlu idempotency key |
| Local DB insert/update | Bisa dibuat idempotent dengan constraint/transaction | Perlu desain schema |
| Email/SMS/notification | Sulit exactly-once | Perlu dedup + event log + user-visible tolerance |
| Payment/settlement | Harus via provider idempotency/reference | Jangan bergantung pada worker memory |

Exactly-once end-to-end sulit karena tidak ada satu transaction manager yang mengikat:

- Zeebe job state,
- local database,
- external REST API,
- message broker,
- email provider,
- third-party system.

Jika sistem Anda mencoba “exactly-once” tanpa idempotency, biasanya yang terjadi adalah **false confidence**.

### 3.2 Staff-level framing

Di level senior/staff, jawaban yang matang bukan:

> “Kita butuh exactly once.”

Tetapi:

> “Kita menerima at-least-once delivery dan mendesain setiap side effect agar idempotent, fenced, deduplicated, observable, dan repairable.”

---

## 4. Taxonomy Eksekusi Worker

Untuk mendesain correctness, pertama klasifikasikan worker berdasarkan efeknya.

### 4.1 Pure computation worker

Contoh:

- menghitung risk score dari variable,
- mapping DTO,
- validasi format,
- menentukan routing decision,
- generate derived data tanpa external write.

Karakteristik:

- relatif mudah dibuat idempotent,
- duplicate execution biasanya aman,
- hasil deterministik lebih disukai.

Risiko:

- nondeterministic value seperti `now()`, random UUID, atau external lookup dapat membuat hasil berbeda.

Prinsip:

```text
Jika worker dapat dibuat pure, buatlah pure.
```

### 4.2 Local database side-effect worker

Contoh:

- membuat record application review,
- update status case,
- insert audit event,
- create task assignment di domain DB.

Karakteristik:

- dapat dibuat idempotent dengan unique constraint,
- transaksi lokal bisa kuat,
- lebih mudah dikontrol daripada third-party API.

Prinsip:

- gunakan idempotency table,
- gunakan unique business key,
- gunakan transaction boundary yang jelas,
- jangan mengandalkan in-memory flag.

### 4.3 External API side-effect worker

Contoh:

- create payment,
- submit data ke regulator lain,
- trigger notification provider,
- call document signing platform,
- call government API.

Karakteristik:

- paling berisiko,
- worker tidak mengontrol transaction boundary external system,
- response bisa hilang,
- timeout bukan berarti gagal.

Prinsip:

- gunakan provider idempotency key jika ada,
- simpan request/response log,
- jangan retry buta,
- sediakan reconciliation.

### 4.4 Message publishing worker

Contoh:

- publish event ke Kafka/RabbitMQ,
- publish command ke downstream,
- emit integration event.

Karakteristik:

- perlu outbox pattern,
- perlu message key/id,
- consumer juga harus idempotent.

Prinsip:

- jangan publish langsung dari worker tanpa durable outbox jika event penting,
- gunakan deterministic event id,
- simpan publish status.

### 4.5 Human-visible side-effect worker

Contoh:

- kirim email,
- kirim SMS,
- create notification,
- generate PDF letter,
- send official correspondence.

Karakteristik:

- duplicate sangat terlihat,
- sering tidak bisa dibatalkan,
- audit penting.

Prinsip:

- dedup berdasarkan business event,
- simpan delivery record,
- gunakan template version,
- log recipient/content hash.

---

## 5. Job Lifecycle Dan Titik Rawan Correctness

Secara sederhana, job melewati state seperti berikut:

```text
CREATED
  |
  | activated by worker
  v
ACTIVATED / leased
  |
  | complete
  v
COMPLETED
```

Atau gagal:

```text
CREATED
  |
  v
ACTIVATED
  |
  | fail with retries > 0
  v
RETRYABLE later
  |
  v
ACTIVATED again
```

Jika retries habis:

```text
ACTIVATED
  |
  | fail with retries = 0
  v
INCIDENT
```

Jika timeout:

```text
ACTIVATED by Worker A
  |
  | activation timeout expires
  v
AVAILABLE again
  |
  v
ACTIVATED by Worker B
```

Titik rawan:

1. Setelah activation sebelum side effect.
2. Saat side effect sedang berjalan.
3. Setelah side effect sukses sebelum complete job.
4. Saat complete command dikirim.
5. Setelah complete accepted tetapi response hilang.
6. Saat fail command dikirim setelah side effect partial.
7. Saat job timeout dan worker lama masih berjalan.

---

## 6. Timeout Bukan Cancellation

Salah satu kesalahan umum:

> “Kalau job timeout, worker A otomatis berhenti.”

Tidak.

Job timeout di Zeebe berarti lease job di engine habis. Worker process Anda tidak otomatis dibunuh. Jika worker A sedang melakukan blocking HTTP call selama 2 menit, sementara job timeout 30 detik, maka skenario ini mungkin terjadi:

```text
T+00s Worker A activates job
T+01s Worker A calls external API
T+30s Job activation timeout expires
T+31s Worker B activates same job
T+40s Worker B calls external API
T+60s Worker A external API returns success
T+61s Worker A tries complete job -> may be rejected
T+70s Worker B complete succeeds
```

Akibatnya external API dapat terpanggil dua kali.

Prinsip:

```text
Job timeout harus lebih besar dari worst-case normal processing time,
tetapi tidak boleh menjadi alasan untuk tidak membuat worker idempotent.
```

### 6.1 Timeout selection heuristic

Gunakan heuristic:

```text
jobTimeout = p99 external call duration
           + p99 local processing duration
           + network margin
           + graceful completion margin
```

Tetapi jangan terlalu besar. Timeout yang terlalu besar membuat recovery lambat saat worker mati.

Contoh:

| Skenario | Timeout terlalu kecil | Timeout terlalu besar |
|---|---|---|
| API lambat | Duplicate execution | Recovery lambat |
| Worker crash | Cepat diambil worker lain | Process stuck lama |
| DB lock wait | Retry overlap | Incident terlambat |
| Human-like external dependency | Banyak duplicate | SLA diagnosis terlambat |

---

## 7. Retry Semantics: Retry Bukan Obat Semua Error

Di Camunda 8, worker bisa gagal job dan menentukan remaining retries/backoff. Tetapi retry hanya aman untuk error tertentu.

### 7.1 Error taxonomy

Gunakan klasifikasi berikut.

| Kategori | Contoh | Retry? | Process path? | Incident? |
|---|---|---:|---|---:|
| Transient technical | network timeout, 503, temporary DB issue | Ya, dengan backoff | Tetap di task sama | Jika habis |
| Rate limit | HTTP 429 | Ya, dengan backoff lebih panjang | Tetap di task sama | Jika habis |
| External maintenance | downstream unavailable | Ya, mungkin long backoff | Tetap di task sama | Bisa jika melewati batas |
| Invalid variable/schema | missing required field | Tidak otomatis | Incident atau BPMN error tergantung konteks | Sering ya |
| Business rejection | applicant not eligible | Tidak sebagai technical retry | BPMN error / gateway business path | Tidak seharusnya incident |
| Permanent technical config | wrong credential, bad URL | Tidak banyak retry | Incident cepat | Ya |
| Data corruption | impossible state | Tidak | Incident + manual repair | Ya |
| Duplicate detected benign | operation already done | Tidak fail | Complete idempotently | Tidak |

### 7.2 Retry yang buruk

Contoh buruk:

```java
catch (Exception e) {
    client.newFailCommand(job.getKey())
        .retries(job.getRetries() - 1)
        .send()
        .join();
}
```

Masalah:

- semua exception dianggap sama,
- tidak ada backoff,
- tidak ada error code,
- tidak ada classification,
- business rejection menjadi incident,
- retry bisa memperburuk external system yang sedang rate limit.

### 7.3 Retry yang lebih matang

Pseudocode:

```java
try {
    handler.handle(job);
    complete(job);
} catch (TransientExternalException e) {
    failWithBackoff(job, e, remainingRetries(job), Duration.ofSeconds(30));
} catch (RateLimitedException e) {
    failWithBackoff(job, e, remainingRetries(job), Duration.ofMinutes(2));
} catch (BusinessRejectionException e) {
    throwBpmnError(job, e.code(), e.message(), e.variables());
} catch (InvalidProcessDataException e) {
    failNoRetry(job, e); // create incident for repair
} catch (Exception e) {
    failWithConservativePolicy(job, e);
}
```

Yang penting bukan syntax, tetapi policy.

---

## 8. BPMN Error vs Job Failure vs Incident

Worker punya beberapa cara memberi tahu engine bahwa sesuatu terjadi.

### 8.1 Complete job

Gunakan ketika:

- business action sukses,
- atau duplicate terdeteksi tetapi state bisnis sudah sesuai,
- atau worker dapat memastikan desired state sudah tercapai.

Contoh idempotent completion:

```text
Worker mencoba create external case.
External system menjawab: case with reference already exists.
Worker memverifikasi existing case cocok dengan request.
Worker complete job dengan externalCaseId existing.
```

### 8.2 Fail job

Gunakan untuk technical failure yang dapat diulang atau perlu incident.

Contoh:

- downstream 503,
- database unavailable,
- timeout,
- temporary auth token failure,
- rate limit.

Jika retries masih ada, job akan dicoba lagi. Jika retries habis, incident dibuat.

### 8.3 Throw BPMN error

Gunakan untuk **business error** yang memang dimodelkan di BPMN.

Contoh:

- applicant not eligible,
- document invalid,
- external verification returns rejected,
- insufficient balance sebagai business outcome,
- license expired sebagai alternate path.

BPMN error bukan “exception teknis”. BPMN error adalah **domain outcome**.

### 8.4 Incident

Incident adalah tanda bahwa process instance tidak bisa lanjut tanpa intervensi atau perubahan kondisi.

Incident cocok untuk:

- data process invalid,
- worker bug,
- config salah,
- downstream permanen unavailable,
- authorization credential salah,
- variable schema mismatch.

Incident bukan pengganti business path.

### 8.5 Decision table mental model

| Situasi | Action Worker |
|---|---|
| Action sukses | Complete job |
| Duplicate request, desired state sudah tercapai | Complete job |
| Downstream timeout, belum tahu hasil | Fail with retry/backoff atau reconcile dulu |
| Downstream 429 | Fail with backoff |
| Invalid user business condition | Throw BPMN error |
| Missing required variable karena model bug | Fail no retry -> incident |
| Credential invalid | Fail no retry atau sedikit retry -> incident |
| Worker code NullPointerException | Fail -> incident jika habis, perbaiki code |

---

## 9. Idempotency: Definisi Yang Operasional

Idempotency sering dijelaskan terlalu abstrak:

> “Operasi idempotent adalah operasi yang bisa dijalankan berkali-kali dengan hasil sama.”

Untuk worker, definisi yang lebih operasional:

> Worker idempotent adalah worker yang, jika menerima job yang sama atau business command yang sama lebih dari sekali, tidak menghasilkan side effect bisnis tambahan yang salah, dan dapat mengembalikan hasil yang konsisten ke process instance.

Ada dua aspek:

1. **Side effect safety**: tidak membuat efek ganda.
2. **Result replay**: bisa mengembalikan output yang sama atau kompatibel saat duplicate terjadi.

Contoh:

```text
Job: create inspection case for application APP-123
First execution:
  creates case CASE-9001
  stores mapping APP-123 -> CASE-9001
  completes job with caseId CASE-9001

Duplicate execution:
  sees mapping APP-123 -> CASE-9001
  does not create another case
  completes job with caseId CASE-9001
```

Itu idempotent.

---

## 10. Memilih Idempotency Key

Kesalahan paling umum adalah memilih key yang salah.

### 10.1 Candidate keys

| Key | Stabil? | Scope | Cocok untuk |
|---|---:|---|---|
| `jobKey` | Stabil untuk job tertentu | Job execution | Dedup job-level |
| `processInstanceKey` | Stabil untuk instance | Process instance | Instance side effect |
| `processDefinitionId` + business id | Stabil lintas retry | Business entity | Start/dedup process |
| BPMN element id | Stabil jika model tidak berubah | Task type within process | Partial key component |
| External request id | Jika dibuat deterministik | External API | Provider idempotency |
| Random UUID per attempt | Tidak | Attempt | Buruk untuk idempotency |
| Timestamp | Tidak | Attempt/time | Buruk |

### 10.2 Key yang buruk

```java
String idempotencyKey = UUID.randomUUID().toString();
```

Ini bukan idempotency key. Ini attempt id.

Jika retry terjadi, UUID berubah, external system melihat request sebagai operasi baru.

### 10.3 Key yang baik

Contoh untuk create external case:

```text
idempotencyKey = processDefinitionId
               + ":" + processInstanceKey
               + ":" + elementId
               + ":" + businessEntityId
               + ":v1"
```

Atau lebih business-stable:

```text
idempotencyKey = "create-inspection-case:application:" + applicationId
```

Pertanyaan penting:

> Apakah side effect ini boleh terjadi sekali per job, sekali per process instance, atau sekali per business entity?

Jawaban menentukan key.

---

## 11. Idempotency Scope

### 11.1 Per job idempotency

Cocok jika side effect benar-benar melekat pada satu job instance.

Contoh:

- generate one audit entry for exact BPMN task execution,
- record worker execution metadata.

Risiko:

- jika process model berubah dan job baru dibuat untuk business action sama, dedup tidak terjadi.

### 11.2 Per process instance idempotency

Cocok jika side effect boleh satu kali dalam satu process instance.

Contoh:

- create one review workspace per application process instance.

Risiko:

- jika process instance di-restart untuk business entity sama, duplicate bisa terjadi.

### 11.3 Per business entity idempotency

Cocok untuk side effect dunia nyata.

Contoh:

- one enforcement case per violation id,
- one payment per invoice id,
- one license issuance per approved application id,
- one official letter per decision id.

Ini biasanya pilihan terbaik untuk domain penting.

### 11.4 Per command idempotency

Cocok ketika upstream mengirim command dengan command id stabil.

Contoh:

```text
commandId = external queue offset
commandId = request id dari API gateway
commandId = user action id dari UI
```

---

## 12. Deduplication Store Design

Worker production-grade biasanya membutuhkan durable dedup store.

### 12.1 Minimal table

```sql
CREATE TABLE worker_idempotency_record (
    idempotency_key        VARCHAR(200) PRIMARY KEY,
    job_type               VARCHAR(100) NOT NULL,
    process_instance_key   VARCHAR(64),
    element_id             VARCHAR(100),
    business_key           VARCHAR(200),
    status                 VARCHAR(30) NOT NULL,
    request_hash           VARCHAR(128) NOT NULL,
    result_json            CLOB,
    error_code             VARCHAR(100),
    created_at             TIMESTAMP NOT NULL,
    updated_at             TIMESTAMP NOT NULL
);
```

Status:

```text
STARTED
SUCCEEDED
FAILED_RETRYABLE
FAILED_FINAL
UNKNOWN
```

### 12.2 Request hash

Idempotency key saja belum cukup. Anda perlu memastikan duplicate request membawa payload yang sama.

Contoh masalah:

```text
idempotencyKey = create-case:APP-123
Attempt 1 payload = applicantName: Alice, type: Renewal
Attempt 2 payload = applicantName: Alice, type: NewApplication
```

Jika key sama tetapi payload berbeda, itu bukan retry aman; itu conflict.

Gunakan `request_hash`:

```text
canonicalize request -> SHA-256 -> request_hash
```

Jika key sama dan hash beda:

- jangan silently reuse result,
- fail no retry,
- create incident,
- minta manual investigation.

### 12.3 Result replay

Jika duplicate execution menemukan status `SUCCEEDED`, worker harus bisa replay result.

```java
Optional<IdempotencyRecord> existing = store.find(key);
if (existing.isPresent() && existing.get().isSucceeded()) {
    completeJob(job, existing.get().resultVariables());
    return;
}
```

Tanpa result replay, worker bisa tahu “sudah pernah sukses” tetapi tidak bisa melanjutkan process dengan variable yang dibutuhkan.

---

## 13. Race Condition Dalam Dedup Store

Jangan lakukan ini:

```java
if (!store.exists(key)) {
    externalApi.call(request);
    store.insertSuccess(key, result);
}
```

Dua worker bisa membaca `exists=false` bersamaan.

Gunakan unique constraint dan atomic insert.

Pola:

```java
boolean owner = store.tryStart(key, requestHash);

if (!owner) {
    IdempotencyRecord record = store.get(key);
    handleExistingRecord(record);
    return;
}

try {
    Result result = externalApi.call(request);
    store.markSucceeded(key, result);
    completeJob(job, result.toVariables());
} catch (Exception e) {
    store.markFailedOrUnknown(key, e);
    throw e;
}
```

`tryStart` harus atomic:

```sql
INSERT INTO worker_idempotency_record (...)
VALUES (...)
```

Jika duplicate key violation terjadi, berarti worker lain sudah mulai.

---

## 14. STARTED Yang Terlalu Lama

Apa yang terjadi jika worker berhasil insert `STARTED`, lalu crash sebelum external API?

Atau crash setelah external API tetapi sebelum mark success?

Dedup store akan punya record `STARTED` menggantung.

Anda butuh policy.

### 14.1 STARTED before external call

```text
STARTED exists
no external reference
age > threshold
```

Kemungkinan:

- worker crash sebelum call,
- aman untuk retry,
- bisa takeover setelah lease internal expired.

### 14.2 STARTED with external reference

```text
STARTED exists
external request id exists
age > threshold
```

Kemungkinan:

- external call sedang berlangsung,
- external call sukses tetapi worker crash,
- external call timeout.

Tindakan:

- query external system by idempotency key/reference,
- reconcile,
- mark succeeded jika ditemukan,
- retry jika pasti belum terjadi,
- incident jika tidak bisa dipastikan.

### 14.3 UNKNOWN status

Jika worker tidak tahu external side effect berhasil atau gagal, jangan asal retry.

Gunakan status:

```text
UNKNOWN
```

Status `UNKNOWN` berarti:

> Automated retry could duplicate a side effect; reconciliation is required before continuing.

---

## 15. External API Timeout: Timeout Bukan Failure

Ini prinsip besar:

```text
HTTP timeout means the caller did not receive response.
It does not prove the callee did not execute the action.
```

Contoh:

```text
Worker -> POST /payments
Request reaches payment provider
Provider charges card
Provider response times out
Worker catches SocketTimeoutException
```

Jika worker langsung retry POST tanpa idempotency key, bisa double charge.

### 15.1 Safe pattern with provider idempotency key

```text
POST /payments
Idempotency-Key: pay:invoice:INV-123
```

Jika timeout, retry dengan idempotency key yang sama.

Provider harus mengembalikan result yang sama atau conflict yang dapat direconcile.

### 15.2 If provider has no idempotency support

Pilihan:

1. Jangan gunakan endpoint tersebut untuk side effect kritikal.
2. Buat wrapper service internal yang memberi idempotency.
3. Gunakan query-before-command jika provider menyediakan lookup by natural key.
4. Setelah timeout, masuk reconciliation flow, bukan retry buta.
5. Modelkan manual investigation jika uang/legal/regulatory effect terlibat.

---

## 16. Transaction Boundary: DB Dulu Atau Complete Job Dulu?

Skenario umum:

```text
Worker updates local DB
Worker completes Zeebe job
```

Tidak ada distributed transaction antara DB dan Zeebe. Maka selalu ada gap.

### 16.1 DB commit sukses, complete job gagal

```text
T1 DB update committed
T2 complete job command fails/network timeout
T3 job retried
```

Solusi:

- DB update harus idempotent,
- duplicate worker melihat DB already updated,
- complete job lagi dengan result sama.

### 16.2 Complete job sukses, DB commit gagal

Jika Anda complete job sebelum DB commit:

```text
T1 complete job accepted
T2 process moves forward
T3 DB commit fails
```

Ini lebih berbahaya karena process lanjut padahal domain state belum benar.

Prinsip umum:

```text
For local durable side effects required by the process, commit local state before completing the job.
Then make retry idempotently complete if local state already exists.
```

### 16.3 Local transaction template

```java
@Transactional
public WorkerResult executeDomainTransaction(Command command) {
    IdempotencyRecord existing = idempotencyStore.find(command.key());
    if (existing != null && existing.succeeded()) {
        return existing.toWorkerResult();
    }

    idempotencyStore.insertStarted(command.key(), command.hash());

    DomainResult result = domainService.apply(command);

    idempotencyStore.markSucceeded(command.key(), result);

    return WorkerResult.from(result);
}
```

Lalu complete job **setelah transaction commit**.

Dalam Spring, hati-hati jika `completeJob()` dipanggil di dalam `@Transactional`. Jika complete diterima tetapi commit DB rollback, state process dan DB bisa diverge.

---

## 17. Outbox Pattern Untuk Worker

Jika worker perlu mengubah DB dan publish event, jangan publish langsung sebelum commit.

### 17.1 Bad pattern

```java
@Transactional
void handle(Job job) {
    repository.save(entity);
    kafkaTemplate.send("events", event); // may publish before commit truly durable
}
```

Jika DB rollback setelah event publish, downstream melihat event palsu.

### 17.2 Better pattern

```text
Worker transaction:
  - apply domain change
  - insert outbox event
  - commit

Outbox publisher:
  - reads unsent event
  - publishes to broker
  - marks sent

Worker:
  - complete job after required local commit
```

Pertanyaan penting:

> Apakah process boleh lanjut setelah domain DB commit tetapi sebelum event dipublish?

Jawabannya tergantung domain.

Jika event adalah side effect wajib sebelum process lanjut, ada dua opsi:

1. Process punya service task terpisah untuk publish event.
2. Worker menunggu outbox publish confirmation dengan timeout/retry policy.

Tetapi jangan mencampur semuanya tanpa boundary.

---

## 18. Inbox Pattern Untuk Command Dari Zeebe

Worker menerima job dari Zeebe. Secara konseptual, job adalah command eksternal ke service Anda.

Inbox pattern berarti service menyimpan command yang diterima sebelum memprosesnya.

```sql
CREATE TABLE worker_inbox (
    command_id             VARCHAR(200) PRIMARY KEY,
    job_key                VARCHAR(64) NOT NULL,
    process_instance_key   VARCHAR(64) NOT NULL,
    job_type               VARCHAR(100) NOT NULL,
    payload_hash           VARCHAR(128) NOT NULL,
    status                 VARCHAR(30) NOT NULL,
    received_at            TIMESTAMP NOT NULL,
    processed_at           TIMESTAMP
);
```

Manfaat:

- duplicate detection,
- audit,
- replay,
- debugging,
- separation between job activation and domain processing.

Tidak semua worker perlu inbox eksplisit. Tetapi untuk side effect penting, inbox/outbox sangat membantu.

---

## 19. Fencing: Mencegah Worker Lama Menulis Setelah Lease Habis

Masalah:

```text
Worker A activates job
Worker A slow
Job timeout
Worker B activates same job
Worker B completes correctly
Worker A resumes and writes stale result to DB/external system
```

Idempotency key membantu, tetapi kadang perlu fencing token.

### 19.1 Fencing concept

Fencing token adalah nilai monotonik/attempt marker yang digunakan untuk menolak penulisan dari actor lama.

Dalam Zeebe, `jobKey` sama untuk job yang sama, tetapi activation attempt dapat berbeda secara waktu. Karena Anda tidak selalu punya monotonic attempt number dari engine, Anda dapat membuat local lease table.

```sql
CREATE TABLE worker_job_lease (
    idempotency_key VARCHAR(200) PRIMARY KEY,
    owner_id        VARCHAR(100) NOT NULL,
    lease_version   BIGINT NOT NULL,
    lease_until     TIMESTAMP NOT NULL
);
```

Worker yang mengambil alih increment `lease_version`. Sebelum menulis side effect local, worker memastikan ia masih pemilik lease terbaru.

### 19.2 Kapan perlu fencing?

Perlu jika:

- worker operation lama,
- side effect bisa ditulis setelah timeout,
- idempotency saja tidak cukup,
- external system tidak punya idempotency,
- local DB update bisa overwritten oleh stale worker.

Tidak selalu perlu untuk worker sederhana.

---

## 20. Business Idempotency vs Technical Idempotency

Ada dua jenis idempotency.

### 20.1 Technical idempotency

Mencegah duplicate karena retry teknis.

Contoh:

```text
Same jobKey executed twice -> do not call API twice
```

### 20.2 Business idempotency

Mencegah duplicate dari sudut domain.

Contoh:

```text
Application APP-123 must only have one active renewal process.
Invoice INV-456 must only be paid once.
Violation V-999 must only create one enforcement case.
```

Business idempotency lebih penting.

Camunda 8.9 memperkenalkan konsep Business ID uniqueness validation di level cluster untuk membantu mencegah duplicate running root process instance dengan Business ID yang sama bila diaktifkan. Tetapi itu tidak menggantikan idempotency untuk worker side effect.

---

## 21. Designing Worker Result Variables Idempotently

Worker tidak hanya melakukan side effect, tetapi juga mengembalikan variables ke process.

Contoh:

```json
{
  "externalCaseId": "CASE-9001",
  "caseCreatedAt": "2026-06-20T10:15:30Z",
  "caseStatus": "OPEN"
}
```

Jika duplicate execution terjadi, result harus konsisten.

### 21.1 Jangan generate result nondeterministic tanpa menyimpannya

Buruk:

```java
Map<String, Object> result = Map.of(
    "externalRequestId", UUID.randomUUID().toString(),
    "createdAt", Instant.now().toString()
);
```

Jika retry, values berubah.

Lebih baik:

- generate sekali,
- simpan di idempotency record,
- replay result saat duplicate.

### 21.2 Variable overwrite discipline

Jika worker complete job dengan variable yang sama, ia dapat overwrite value process-level.

Prinsip:

- output variable harus minimal,
- gunakan namespacing,
- jangan overwrite variable domain besar tanpa alasan,
- hindari output ambigu seperti `status` generik.

Contoh lebih baik:

```json
{
  "externalVerification": {
    "provider": "ABC",
    "requestId": "verify-APP-123",
    "result": "APPROVED",
    "checkedAt": "2026-06-20T10:15:30Z"
  }
}
```

---

## 22. Retry Backoff: Jangan Membuat Thundering Herd

Jika downstream mati dan ribuan jobs gagal lalu retry segera, Anda menciptakan thundering herd.

### 22.1 Bad retry

```text
10000 jobs fail
retryBackoff = 0
all become available immediately
workers hammer downstream again
```

### 22.2 Better retry

Gunakan backoff berdasarkan klasifikasi:

| Error | Backoff |
|---|---:|
| Short network glitch | 5–15 detik |
| Downstream 503 | 30–120 detik |
| Rate limit 429 | mengikuti Retry-After atau 1–5 menit |
| Maintenance window | 10–30 menit atau incident/manual hold |
| Credential invalid | no retry / very low retry |

### 22.3 Jitter

Jika bisa, tambahkan jitter di sisi worker policy agar retry tidak sinkron.

```java
Duration base = Duration.ofSeconds(60);
Duration jitter = Duration.ofSeconds(ThreadLocalRandom.current().nextInt(0, 30));
Duration backoff = base.plus(jitter);
```

---

## 23. Retry Budget

Setiap worker harus punya retry budget.

Bukan hanya:

```text
retries = 3
```

Tetapi:

```text
Total retry window = 15 minutes
Max attempts = 5
Backoff = exponential with cap
Escalation = incident after exhaustion
```

Contoh:

| Attempt | Backoff before next |
|---:|---:|
| 1 | 30s |
| 2 | 2m |
| 3 | 5m |
| 4 | 10m |
| 5 | incident |

Retry budget harus align dengan:

- SLA process,
- external system recovery expectation,
- operational support hours,
- business criticality,
- legal/regulatory deadline.

---

## 24. Poison Job

Poison job adalah job yang akan selalu gagal karena payload/data/model tidak valid.

Contoh:

```json
{
  "applicationId": null
}
```

Jika worker terus retry, hasilnya hanya noise.

Policy:

- validasi input di awal,
- fail no retry untuk invalid process data,
- error message harus jelas,
- incident harus actionable.

Contoh incident message yang buruk:

```text
NullPointerException
```

Contoh yang baik:

```text
Missing required variable 'applicationId' for job type 'create-review-case'.
Expected non-blank string. Process cannot continue until variable is corrected.
```

---

## 25. Error Message Engineering

Error message worker akan dibaca oleh operator, developer, BA, atau production support.

Error message harus berisi:

- job type,
- business identifier,
- external system name,
- classification,
- retryability,
- safe next action,
- correlation id,
- short root cause.

Template:

```text
Worker failed [jobType=create-review-case]
classification=INVALID_PROCESS_DATA
businessKey=APP-123
processInstanceKey=2251799813685249
reason=Missing required variable 'applicationId'
retryable=false
action=Update process variable or cancel instance after investigation
correlationId=...
```

Hindari:

- stack trace tanpa context,
- message terlalu panjang,
- PII di error message,
- credential/token di logs.

---

## 26. Java Implementation Blueprint

Bagian ini memberi blueprint konseptual, bukan framework final.

### 26.1 Domain exception taxonomy

```java
public abstract class WorkerDomainException extends RuntimeException {
    private final String code;
    private final boolean retryable;

    protected WorkerDomainException(String code, String message, boolean retryable, Throwable cause) {
        super(message, cause);
        this.code = code;
        this.retryable = retryable;
    }

    public String code() {
        return code;
    }

    public boolean retryable() {
        return retryable;
    }
}
```

```java
public final class TransientExternalSystemException extends WorkerDomainException {
    public TransientExternalSystemException(String message, Throwable cause) {
        super("TRANSIENT_EXTERNAL_SYSTEM", message, true, cause);
    }
}
```

```java
public final class BusinessRejectionException extends WorkerDomainException {
    private final Map<String, Object> variables;

    public BusinessRejectionException(String code, String message, Map<String, Object> variables) {
        super(code, message, false, null);
        this.variables = Map.copyOf(variables);
    }

    public Map<String, Object> variables() {
        return variables;
    }
}
```

```java
public final class InvalidProcessDataException extends WorkerDomainException {
    public InvalidProcessDataException(String message) {
        super("INVALID_PROCESS_DATA", message, false, null);
    }
}
```

### 26.2 Worker command object

```java
public final class WorkerCommand {
    private final String idempotencyKey;
    private final String requestHash;
    private final String processInstanceKey;
    private final String jobKey;
    private final String businessKey;
    private final Map<String, Object> variables;

    public WorkerCommand(
            String idempotencyKey,
            String requestHash,
            String processInstanceKey,
            String jobKey,
            String businessKey,
            Map<String, Object> variables
    ) {
        this.idempotencyKey = Objects.requireNonNull(idempotencyKey);
        this.requestHash = Objects.requireNonNull(requestHash);
        this.processInstanceKey = Objects.requireNonNull(processInstanceKey);
        this.jobKey = Objects.requireNonNull(jobKey);
        this.businessKey = Objects.requireNonNull(businessKey);
        this.variables = Map.copyOf(variables);
    }

    public String idempotencyKey() { return idempotencyKey; }
    public String requestHash() { return requestHash; }
    public String processInstanceKey() { return processInstanceKey; }
    public String jobKey() { return jobKey; }
    public String businessKey() { return businessKey; }
    public Map<String, Object> variables() { return variables; }
}
```

Compatible dengan Java 8 jika tidak menggunakan `record`.

Untuk Java 16+, bisa menjadi:

```java
public record WorkerCommand(
        String idempotencyKey,
        String requestHash,
        String processInstanceKey,
        String jobKey,
        String businessKey,
        Map<String, Object> variables
) {}
```

### 26.3 Idempotent executor

```java
public final class IdempotentWorkerExecutor {
    private final IdempotencyStore store;
    private final DomainAction action;

    public IdempotentWorkerExecutor(IdempotencyStore store, DomainAction action) {
        this.store = store;
        this.action = action;
    }

    public WorkerResult execute(WorkerCommand command) {
        IdempotencyRecord existing = store.find(command.idempotencyKey());

        if (existing != null) {
            return handleExisting(existing, command);
        }

        boolean started = store.tryInsertStarted(
                command.idempotencyKey(),
                command.requestHash(),
                command.jobKey(),
                command.processInstanceKey(),
                command.businessKey()
        );

        if (!started) {
            IdempotencyRecord concurrent = store.find(command.idempotencyKey());
            return handleExisting(concurrent, command);
        }

        try {
            WorkerResult result = action.execute(command);
            store.markSucceeded(command.idempotencyKey(), result.variables());
            return result;
        } catch (UncertainExternalOutcomeException e) {
            store.markUnknown(command.idempotencyKey(), e.getMessage());
            throw e;
        } catch (RuntimeException e) {
            store.markFailed(command.idempotencyKey(), e.getMessage());
            throw e;
        }
    }

    private WorkerResult handleExisting(IdempotencyRecord existing, WorkerCommand command) {
        if (!existing.requestHash().equals(command.requestHash())) {
            throw new InvalidProcessDataException(
                    "Idempotency key conflict. Same key but different request hash: "
                            + command.idempotencyKey()
            );
        }

        if (existing.isSucceeded()) {
            return WorkerResult.completed(existing.resultVariables());
        }

        if (existing.isUnknown()) {
            throw new UncertainExternalOutcomeException(
                    "Previous attempt has unknown external outcome for key " + command.idempotencyKey()
            );
        }

        if (existing.isStartedButExpired()) {
            // Depending on domain policy: takeover, reconcile, or fail.
            throw new TransientExternalSystemException(
                    "Previous attempt still in progress or needs reconciliation", null
            );
        }

        throw new TransientExternalSystemException(
                "Duplicate attempt while previous attempt is not completed", null
        );
    }
}
```

### 26.4 Worker adapter pseudo-code

```java
public void handleJob(ActivatedJob job) {
    WorkerCommand command = commandFactory.from(job);

    try {
        WorkerResult result = executor.execute(command);
        complete(job, result.variables());
    } catch (BusinessRejectionException e) {
        throwBpmnError(job, e.code(), e.getMessage(), e.variables());
    } catch (InvalidProcessDataException e) {
        failNoRetry(job, e);
    } catch (TransientExternalSystemException e) {
        failWithBackoff(job, e, calculateRetries(job), calculateBackoff(e));
    } catch (UncertainExternalOutcomeException e) {
        failNoRetry(job, e); // or route to reconciliation process
    } catch (Exception e) {
        failConservatively(job, e);
    }
}
```

---

## 27. Avoiding Complete-In-Transaction Pitfall

Jika Anda menggunakan Spring:

```java
@JobWorker(type = "create-case")
@Transactional
public Map<String, Object> handle(JobClient client, ActivatedJob job) {
    domainService.createCase(...);
    return Map.of("caseId", "CASE-1");
}
```

Tergantung starter dan auto-completion behavior, Anda harus memahami kapan job complete dikirim relatif terhadap transaction commit.

Prinsip aman:

1. Domain transaction commit dulu.
2. Baru complete job.
3. Jika complete gagal, retry harus mendeteksi domain state already done dan complete ulang.

Jika framework auto-complete menyulitkan boundary, gunakan manual completion atau pisahkan handler agar transaction selesai sebelum complete.

---

## 28. Duplicate Completion Handling

Jika duplicate worker mencoba complete job yang sudah completed atau no longer activatable, complete command dapat ditolak.

Cara membaca:

- Jika business side effect sudah idempotent dan job sudah selesai, rejection complete mungkin benign.
- Tetapi worker harus log dengan context.
- Jangan panik hanya karena complete rejected; lihat apakah process already advanced.

Namun hati-hati:

- Jika complete rejected karena process canceled, jangan lanjut side effect baru.
- Jika complete rejected karena timeout dan worker lama masih berjalan, itu tanda timeout/concurrency policy perlu diperiksa.

---

## 29. Idempotency Untuk Message Publishing Ke Camunda

Part ini fokus worker, tetapi idempotency juga berlaku saat publish message ke Camunda.

Camunda message memiliki optional message ID untuk uniqueness. Gunakan message ID stabil jika event dari upstream dapat dikirim ulang.

Contoh:

```text
messageName = "PaymentReceived"
correlationKey = invoiceId
messageId = "payment-received:" + providerTransactionId
```

Jangan:

```text
messageId = random UUID every retry
```

Message idempotency membantu mencegah message duplicate diproses sebagai event baru. Tetapi tetap desain process agar duplicate business event tidak merusak state.

---

## 30. Idempotent Process Start

Selain worker, process start juga bisa duplicate.

Contoh:

- user double-click submit,
- API gateway retries request,
- upstream event delivered twice,
- scheduler runs twice.

Strategi:

1. Gunakan business id stabil.
2. Simpan process instance mapping di domain DB.
3. Jika start duplicate, return existing process instance.
4. Gunakan Camunda 8 Business ID uniqueness feature jika sesuai versi/deployment dan policy cluster.

Pola:

```text
POST /applications/APP-123/start-review
  check local table application_process
  if exists running/completed: return existing
  else create process instance with business id APP-123
  store mapping
```

Tetap perhatikan race condition dengan unique constraint.

---

## 31. Human Repair Flow

Tidak semua failure harus diselesaikan retry otomatis.

Untuk domain penting, siapkan repair flow:

```text
Worker detects UNKNOWN external outcome
        |
        v
Fail job with no retry / create incident
        |
        v
Support checks reconciliation dashboard
        |
        v
If external action succeeded:
    update variables + resolve incident
If external action did not happen:
    increase retries / restart action
If ambiguous:
    escalate to business owner
```

Untuk regulatory systems, human repair harus:

- auditable,
- authorized,
- explainable,
- linked to case/application id,
- preserve original error and operator decision.

---

## 32. Observability For Correctness

Metrics worker correctness:

| Metric | Meaning |
|---|---|
| `worker_job_attempt_total` | How many attempts per job type |
| `worker_duplicate_detected_total` | Duplicate idempotency hits |
| `worker_idempotency_conflict_total` | Same key different payload |
| `worker_unknown_outcome_total` | External uncertainty |
| `worker_bpmn_error_total` | Business errors thrown |
| `worker_job_failure_total` | Technical failures |
| `worker_retry_exhausted_total` | Incident risk |
| `worker_external_call_timeout_total` | Downstream uncertainty |
| `worker_complete_rejected_total` | Complete command rejected |

Structured log fields:

```text
jobType
jobKey
processInstanceKey
processDefinitionId
elementId
businessKey
idempotencyKey
requestHash
externalSystem
externalRequestId
attempt
classification
retryable
remainingRetries
backoffMs
correlationId
```

Trace spans:

```text
worker.handle
  domain.validate
  idempotency.lookup
  idempotency.tryStart
  external.call
  idempotency.markSucceeded
  zeebe.completeJob
```

---

## 33. Correctness Review Checklist

Gunakan checklist ini untuk setiap job worker.

### 33.1 Contract

- [ ] Job type jelas dan versioned jika perlu.
- [ ] Input variables minimal dan tervalidasi.
- [ ] Output variables jelas dan namespaced.
- [ ] Error code terdokumentasi.
- [ ] BPMN error vs technical failure dibedakan.

### 33.2 Idempotency

- [ ] Side effect classification jelas.
- [ ] Idempotency key stabil.
- [ ] Key scope sesuai business invariant.
- [ ] Request hash disimpan.
- [ ] Result dapat direplay.
- [ ] Duplicate dengan payload beda dianggap conflict.
- [ ] STARTED/UNKNOWN punya policy.

### 33.3 Retry

- [ ] Error taxonomy ada.
- [ ] Transient error memakai backoff.
- [ ] Rate limit punya policy.
- [ ] Business rejection tidak menjadi retry teknis.
- [ ] Poison job tidak retry tanpa akhir.
- [ ] Retry budget selaras SLA.

### 33.4 Transaction

- [ ] Local DB commit sebelum complete job untuk required side effect.
- [ ] Complete failure setelah DB commit aman diretry.
- [ ] External API timeout tidak dianggap pasti gagal.
- [ ] Outbox digunakan untuk durable publish.
- [ ] Tidak ada hidden distributed transaction assumption.

### 33.5 Operations

- [ ] Error message actionable.
- [ ] Log punya process/job/business context.
- [ ] Metrics duplicate/unknown/retry tersedia.
- [ ] Incident playbook ada.
- [ ] Manual repair path jelas.

---

## 34. Case Study 1: Duplicate External Case Creation

### 34.1 Bad design

```text
Service task: Create Enforcement Case
Worker:
  POST /cases
  complete job with caseId
```

Failure:

```text
POST /cases succeeds -> CASE-1
Worker crashes before complete
Job timeout
Worker retries
POST /cases succeeds -> CASE-2
Process completes with CASE-2
Business now has duplicate cases
```

### 34.2 Better design

```text
idempotencyKey = create-enforcement-case:violation:V-123
externalReference = V-123
```

Worker:

1. Insert idempotency STARTED with key.
2. Call external API with external reference/idempotency key.
3. If success, store `CASE-1` in result.
4. Complete job.
5. If duplicate retry, replay `CASE-1`.
6. If external timeout, query case by `V-123` before retry.

Business invariant:

```text
One violation can create at most one active enforcement case.
```

Worker design enforces that invariant.

---

## 35. Case Study 2: Business Rejection Treated As Technical Failure

### 35.1 Bad design

External verification returns:

```json
{
  "status": "REJECTED",
  "reason": "DOCUMENT_EXPIRED"
}
```

Worker throws exception:

```java
throw new RuntimeException("Verification rejected");
```

Zeebe retries.

After retries exhausted, incident appears.

Problem:

- nothing is technically broken,
- process should follow rejection path,
- support sees fake incident,
- SLA metrics polluted.

### 35.2 Better design

Model BPMN boundary error:

```text
Error code: DOCUMENT_EXPIRED
```

Worker:

```java
throwBpmnError(job, "DOCUMENT_EXPIRED", "Document expired", Map.of(
    "verificationStatus", "REJECTED",
    "rejectionReason", "DOCUMENT_EXPIRED"
));
```

Process follows business path:

```text
Request updated document -> Wait for applicant -> Re-verify
```

---

## 36. Case Study 3: Job Timeout Too Small

Worker timeout: 30 seconds. External API p99: 45 seconds.

Symptoms:

- duplicate detected high,
- complete rejected high,
- external system sees repeated requests,
- Operate shows retries/incidents intermittently,
- worker logs show success and failure for same job.

Root cause:

```text
jobTimeout < normal processing duration
```

Fix:

1. Increase job timeout above p99 + margin.
2. Add HTTP client timeout lower than job timeout.
3. Add idempotency key.
4. Add duplicate metrics.
5. Consider splitting task if operation long-running.

---

## 37. Case Study 4: Complete Job Before DB Commit

Bad flow:

```text
Worker calculates approval
Worker completes Zeebe job
Process moves to Notify Applicant
DB approval update fails
Applicant notified approved, DB still pending
```

Fix:

```text
Worker calculates approval
DB transaction commits approval + idempotency result
Worker completes job
If complete fails, retry sees approval already committed and completes again
```

---

## 38. Advanced Pattern: Reconciliation Worker

Untuk external side effect yang ambiguous, buat worker/proses rekonsiliasi.

```text
Main worker detects UNKNOWN
        |
        v
Creates incident or emits reconciliation needed event
        |
        v
Reconciliation worker queries external system by idempotency key
        |
        +-- found success -> mark succeeded -> resolve incident / complete next step
        +-- found failure -> allow retry
        +-- still unknown -> escalate human
```

Reconciliation bukan afterthought. Untuk payment, legal filing, regulatory submission, document issuance, dan notification resmi, reconciliation adalah bagian dari correctness design.

---

## 39. Advanced Pattern: Reservation / Confirmation

Untuk operasi sulit dibatalkan, gunakan dua tahap.

```text
Reserve resource
  -> if success, process continues
  -> if process later fails, release reservation
Confirm resource
  -> final irreversible action
```

Contoh:

```text
Reserve appointment slot
Verify applicant eligibility
Approve application
Confirm appointment
```

Setiap tahap punya idempotency key berbeda:

```text
reserve-slot:APP-123
confirm-slot:APP-123
release-slot:APP-123
```

---

## 40. Advanced Pattern: Forward Recovery

Tidak semua saga harus rollback.

Untuk long-running business processes, sering lebih baik melakukan forward recovery:

```text
Document submission failed
  -> request resubmission
Payment confirmation delayed
  -> wait and reconcile
External case already exists
  -> attach existing case
Notification failed
  -> retry alternative channel
```

Forward recovery cocok untuk:

- regulatory workflow,
- human approval,
- case management,
- multi-agency integration,
- systems with irreversible actions.

---

## 41. Worker Correctness In Regulatory Systems

Untuk sistem regulasi/enforcement, correctness bukan hanya technical.

Anda harus bisa menjawab:

1. Kenapa action dijalankan?
2. Siapa/apa yang memicu action?
3. Apakah action pernah dicoba sebelumnya?
4. Apakah retry terjadi?
5. Apakah duplicate dicegah?
6. Apakah outcome external pasti?
7. Jika tidak pasti, siapa yang merekonsiliasi?
8. Apakah process path sesuai business rule?
9. Apakah error teknis dibedakan dari rejection bisnis?
10. Apakah audit trail cukup untuk dispute?

Worker idempotency record dapat menjadi evidence layer.

Minimal audit fields:

```text
idempotencyKey
businessEntityId
processInstanceKey
jobKey
jobType
externalSystem
externalRequestId
requestHash
resultHash
status
attemptCount
firstAttemptAt
lastAttemptAt
operatorAction
incidentId
```

---

## 42. Practical Worker Correctness Architecture

Recommended architecture:

```text
Camunda 8 / Zeebe
      |
      v
Worker Adapter
      |
      +--> Variable Parser / Validator
      |
      +--> Idempotency Key Factory
      |
      +--> Error Classifier
      |
      v
Application Use Case
      |
      +--> Idempotency Store
      +--> Domain Repository
      +--> External Gateway
      +--> Outbox
      |
      v
Worker Result Mapper
      |
      v
Complete / Fail / BPMN Error
```

Layer responsibility:

| Layer | Responsibility |
|---|---|
| Worker adapter | Translate Zeebe job to application command |
| Validator | Validate variables and schema |
| Idempotency key factory | Create stable key |
| Use case | Execute business action |
| Idempotency store | Dedup, replay, unknown tracking |
| External gateway | Encapsulate provider semantics |
| Error classifier | Map exceptions to retry/BPMN/incident |
| Result mapper | Produce process variables |

---

## 43. Do Not Hide Worker Correctness In Annotations

Spring annotations are convenient:

```java
@JobWorker(type = "send-email")
public Map<String, Object> sendEmail(MyVariables vars) {
    emailService.send(vars.email());
    return Map.of("sent", true);
}
```

Tetapi annotation tidak menjawab:

- Apakah email duplicate aman?
- Apa idempotency key-nya?
- Apa yang terjadi jika SMTP timeout?
- Apakah result bisa direplay?
- Apakah rejection bisnis berbeda dari technical error?
- Apakah complete terjadi setelah local audit commit?

Gunakan annotation sebagai adapter, bukan sebagai tempat semua logic.

---

## 44. Anti-Patterns

### 44.1 Random idempotency key

```java
UUID.randomUUID()
```

Itu attempt id, bukan idempotency key.

### 44.2 Blind retry all exceptions

Semua exception dikurangi retry. Business rejection menjadi incident.

### 44.3 Complete before durable state

Process lanjut walau local DB gagal.

### 44.4 No result replay

Duplicate detected tetapi worker tidak bisa complete karena output lama tidak disimpan.

### 44.5 Huge retry count

`retries=999` menunda incident dan menyembunyikan bug.

### 44.6 Job timeout lebih kecil dari normal processing time

Menciptakan duplicate worker execution.

### 44.7 External timeout dianggap gagal

Bisa duplicate irreversible operation.

### 44.8 Incident message tanpa context

Support tidak bisa repair.

### 44.9 Variable overwrite sembarangan

Worker mengubah process state yang bukan miliknya.

### 44.10 Tidak ada reconciliation

UNKNOWN outcome diperlakukan sebagai retry biasa.

---

## 45. Mental Model Final

Untuk setiap worker, tanyakan lima pertanyaan:

### 45.1 What is the command?

Apa business command yang sebenarnya dijalankan worker?

```text
create case?
verify applicant?
send notification?
reserve slot?
issue license?
```

### 45.2 What is the invariant?

Apa yang tidak boleh dilanggar?

```text
One invoice paid once.
One violation creates one enforcement case.
One decision letter sent once per decision version.
```

### 45.3 What is the idempotency key?

Apa identifier stabil untuk invariant itu?

### 45.4 What can be retried safely?

Kesalahan mana transient, mana business, mana corrupt?

### 45.5 How do we recover uncertainty?

Jika side effect mungkin sudah terjadi tetapi worker tidak tahu, bagaimana rekonsiliasinya?

Jika lima pertanyaan ini tidak punya jawaban, worker belum production-grade.

---

## 46. Summary

Part ini membahas worker correctness sebagai inti production Camunda 8.

Poin utama:

1. Job worker harus diasumsikan menerima job lebih dari sekali.
2. Exactly-once end-to-end adalah ilusi jika ada external side effect.
3. Idempotency harus didesain berdasarkan business invariant.
4. Retry hanya cocok untuk transient technical failure.
5. Business rejection harus menjadi BPMN path, bukan incident palsu.
6. Timeout bukan cancellation.
7. HTTP timeout bukan bukti external action gagal.
8. Local DB commit sebaiknya terjadi sebelum complete job untuk side effect wajib.
9. Dedup store harus bisa menyimpan request hash dan result replay.
10. UNKNOWN external outcome membutuhkan reconciliation, bukan retry buta.
11. Observability correctness harus mencakup duplicate, conflict, unknown, retry, dan complete rejection.
12. Worker adapter harus tipis; correctness hidup di application/use-case layer.

---

## 47. Checklist Untuk Menguji Pemahaman

Coba jawab tanpa melihat materi:

1. Mengapa worker harus idempotent?
2. Apa bedanya job timeout dan cancellation?
3. Mengapa HTTP timeout tidak boleh dianggap external failure?
4. Kapan worker harus `complete`, `fail`, atau `throw BPMN error`?
5. Apa perbedaan technical idempotency dan business idempotency?
6. Mengapa `UUID.randomUUID()` bukan idempotency key?
7. Apa fungsi request hash dalam dedup store?
8. Apa yang harus dilakukan jika idempotency record status `UNKNOWN`?
9. Mengapa complete job sebelum DB commit berbahaya?
10. Apa metric penting untuk worker correctness?
11. Bagaimana cara mencegah duplicate email resmi?
12. Bagaimana cara mendesain retry untuk rate limit 429?
13. Apa beda retry budget dan retry count?
14. Mengapa poison job tidak boleh retry tanpa akhir?
15. Bagaimana cara menjelaskan worker correctness ke auditor/regulator?

---

## 48. Referensi Resmi Yang Relevan

- Camunda 8 Docs — Job workers concept: https://docs.camunda.io/docs/components/concepts/job-workers/
- Camunda 8 Docs — Java client job worker: https://docs.camunda.io/docs/apis-tools/java-client/job-worker/
- Camunda 8 Docs — Writing good workers: https://docs.camunda.io/docs/components/best-practices/development/writing-good-workers/
- Camunda 8 Docs — Dealing with problems and exceptions: https://docs.camunda.io/docs/components/best-practices/development/dealing-with-problems-and-exceptions/
- Camunda 8 Docs — Incidents: https://docs.camunda.io/docs/components/concepts/incidents/
- Camunda 8 Docs — Fail job REST API: https://docs.camunda.io/docs/apis-tools/orchestration-cluster-api-rest/specifications/fail-job/
- Camunda 8 Docs — Throw job error REST API: https://docs.camunda.io/docs/apis-tools/orchestration-cluster-api-rest/specifications/throw-job-error/
- Camunda 8 Docs — Messages and message uniqueness: https://docs.camunda.io/docs/components/concepts/messages/
- Camunda 8 Docs — Spring Boot Starter configuration: https://docs.camunda.io/docs/apis-tools/camunda-spring-boot-starter/configuration/
- Camunda 8.9 Release Notes — Business ID uniqueness: https://docs.camunda.io/docs/reference/announcements-release-notes/890/890-release-notes/

---

## 49. Status Seri

Seri **belum selesai**.

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-008.md
```

Judul:

```text
Part 008 — Variables, Serialization, Payload Discipline, and Data Contracts
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-006.md">⬅️ Part 006 — Building Production-Grade Java Job Workers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-008.md">Part 008 — Variables, Serialization, Payload Discipline, and Data Contracts ➡️</a>
</div>
