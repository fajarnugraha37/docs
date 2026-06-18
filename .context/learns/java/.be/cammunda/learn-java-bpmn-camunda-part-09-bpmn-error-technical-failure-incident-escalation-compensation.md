# learn-java-bpmn-camunda-process-orchestration-engineering

# Part 9 — BPMN Error, Technical Failure, Incident, Escalation, and Compensation

> Seri: Java BPMN, Camunda, Process Orchestration Engineering  
> Target: Java 8 hingga Java 25  
> Fokus: membedakan dan mendesain failure handling pada workflow production-grade  
> Status: Part 9 dari 30

---

## 0. Tujuan Pembelajaran

Pada bagian sebelumnya kita sudah membahas:

1. mental model process orchestration,
2. BPMN sebagai execution contract,
3. elemen inti BPMN,
4. modeling discipline,
5. perbedaan Camunda 7 dan Camunda 8,
6. internal Zeebe,
7. Java client/worker engineering,
8. process variable governance.

Sekarang kita masuk ke salah satu area paling menentukan kualitas engineer workflow: **failure semantics**.

Banyak sistem workflow gagal bukan karena engineer tidak tahu cara menggambar BPMN, tetapi karena tidak jelas membedakan:

- error teknis,
- business exception,
- BPMN error,
- incident operasional,
- escalation,
- timeout,
- retry,
- compensation,
- manual repair,
- cancellation,
- rollback database,
- reversal business.

Di sistem biasa, exception sering hanya berarti `throw new RuntimeException()`. Di workflow engine, itu terlalu kasar. Workflow berjalan lama. Step bisa berlangsung detik, jam, hari, minggu, bahkan bulan. Karena itu setiap failure harus diberi makna.

Part ini bertujuan membuat Anda mampu menjawab pertanyaan berikut dengan presisi:

1. Failure ini harus di-retry atau tidak?
2. Ini technical failure atau business failure?
3. Ini harus menjadi incident, BPMN error, escalation, atau compensation?
4. Apakah proses harus berhenti, menunggu, lanjut jalur alternatif, atau dikirim ke manusia?
5. Apakah kita butuh rollback database atau compensation business?
6. Apa yang harus bisa dilihat operator di production?
7. Apa yang harus bisa dijelaskan ke auditor dua tahun kemudian?

---

## 1. Core Mental Model

Workflow failure handling bukan sekadar `try-catch`.

Dalam BPMN/Camunda, failure handling adalah gabungan dari:

```text
Runtime semantics
  + business semantics
  + operational semantics
  + audit semantics
  + repair semantics
```

Artinya, ketika sesuatu gagal, kita tidak hanya bertanya:

```text
Exception apa yang terjadi?
```

Kita bertanya:

```text
Apakah kegagalan ini bagian dari kemungkinan bisnis yang valid?
Apakah sistem harus mencoba lagi?
Apakah proses perlu pindah jalur?
Apakah manusia perlu mengambil alih?
Apakah ada side effect yang harus dibatalkan secara business?
Apakah failure ini harus menciptakan incident agar operator memperbaikinya?
```

Top 1% engineer tidak mendesain workflow dengan asumsi semua step berhasil. Mereka mendesain workflow dengan asumsi:

- external system akan down,
- message bisa terlambat,
- worker bisa crash,
- API bisa sukses tetapi response hilang,
- user bisa tidak merespons,
- approval bisa ditolak,
- dokumen bisa invalid,
- pembayaran bisa berhasil sebagian,
- process model bisa berubah,
- operator butuh repair tanpa corrupt audit trail.

---

## 2. Taxonomy Failure di Workflow

Kita mulai dengan taxonomy.

| Jenis | Makna | Contoh | Handling umum |
|---|---|---|---|
| Technical failure | Infrastruktur/sistem gagal | timeout, DB down, HTTP 503 | retry, backoff, incident |
| Transient failure | Sementara, kemungkinan pulih | network glitch, rate limit | retry dengan backoff |
| Permanent technical failure | Tidak akan pulih tanpa perubahan | config salah, schema mismatch | incident/manual repair |
| Business exception | Kondisi bisnis valid tapi tidak happy path | applicant tidak eligible | BPMN error / gateway path |
| Validation failure | Input tidak memenuhi aturan | dokumen kurang | user correction path |
| SLA breach | Waktu respons terlampaui | officer belum approve 5 hari | timer/escalation |
| External rejection | Sistem eksternal menolak request | payment declined | BPMN error / alternative path |
| Partial side effect | Sebagian aksi sudah sukses | payment captured, email gagal | compensation / forward recovery |
| Model/config error | BPMN/FEEL/variable salah | condition bukan boolean | incident |
| Operator repair case | Butuh intervensi manusia teknis | wrong variable, retry exhausted | incident resolution/runbook |

Perhatikan bahwa tidak semua failure adalah error yang sama. Salah klasifikasi akan merusak desain.

Contoh:

```text
Payment declined karena kartu tidak valid
```

Ini bukan technical failure. Jangan retry 10 kali. Ini business outcome.

```text
Payment provider timeout
```

Ini technical/transient failure. Bisa retry, tapi harus idempotent.

```text
Payment provider menerima request, capture sukses, tetapi response timeout
```

Ini ambiguous side-effect failure. Retry buta bisa double charge. Perlu idempotency key dan reconciliation.

---

## 3. Lima Jalur Failure Handling

Secara praktis, sebuah failure dapat diarahkan ke lima jalur besar.

```text
Failure detected
  |
  +--> Retry technical operation
  |
  +--> Route to business alternative path
  |
  +--> Raise incident for operator repair
  |
  +--> Escalate to human/supervisor
  |
  +--> Compensate completed side effects
```

Masing-masing punya makna berbeda.

### 3.1 Retry

Retry cocok ketika failure kemungkinan sementara.

Contoh:

- HTTP 502,
- temporary network failure,
- DB connection temporarily unavailable,
- external system maintenance pendek,
- rate limit yang bisa di-backoff.

Retry tidak cocok untuk:

- invalid payload,
- unauthorized karena credential salah,
- business rejection,
- validation failure,
- duplicate operation tanpa idempotency.

### 3.2 Business Alternative Path

Business alternative path cocok ketika outcome bukan error teknis, melainkan cabang proses yang legitimate.

Contoh:

- application rejected,
- applicant needs resubmission,
- payment declined,
- risk score high,
- supervisor approval required,
- document insufficient.

Di BPMN, ini biasanya dimodelkan dengan:

- exclusive gateway,
- BPMN error boundary event,
- event subprocess,
- conditional path,
- user correction path.

### 3.3 Incident

Incident adalah tanda bahwa engine/process instance tidak bisa melanjutkan tanpa tindakan korektif. Dalam Camunda 8, incident dapat terjadi misalnya ketika job gagal dan retry habis, expression condition tidak menghasilkan boolean, timer expression salah tipe, decision gagal dievaluasi, atau BPMN error dilempar tetapi tidak ditangkap oleh boundary/event subprocess.

Incident berarti:

```text
Process instance stuck intentionally until problem resolved.
```

Ini bukan sekadar log error. Ini operational object.

### 3.4 Escalation

Escalation adalah sinyal bahwa flow perlu memberi tahu atau memicu level lebih tinggi, tetapi tidak selalu berarti fatal.

Contoh:

- SLA hampir breach,
- officer tidak merespons,
- approval terlalu lama,
- risiko meningkat,
- perlu supervisor attention.

Escalation cocok untuk human/business escalation, bukan untuk network timeout biasa.

### 3.5 Compensation

Compensation adalah aksi business untuk “membalikkan” efek dari langkah yang sudah sukses.

Contoh:

- membatalkan reservasi,
- refund payment,
- revoke generated license,
- cancel scheduled inspection,
- send correction notification,
- mark external record as withdrawn.

Compensation bukan rollback database biasa. Compensation adalah business operation baru yang memiliki audit trail sendiri.

---

## 4. Technical Failure vs Business Failure

Ini pembeda paling penting.

### 4.1 Technical Failure

Technical failure berarti proses gagal karena sistem tidak mampu menyelesaikan operasi sebagaimana mestinya.

Contoh:

```text
POST /payment timed out
```

```text
Oracle connection pool exhausted
```

```text
HTTP 503 from external document service
```

```text
JSON serialization error karena DTO berubah
```

Handling:

- retry jika transient,
- backoff jika external dependency butuh waktu recovery,
- incident jika retry habis,
- alert operator,
- repair data/config/code,
- retry manually setelah fix.

### 4.2 Business Failure

Business failure berarti proses berhasil mengeksekusi rule, tetapi hasilnya adalah negative/alternative outcome.

Contoh:

```text
Applicant is not eligible.
```

```text
Payment declined.
```

```text
Officer rejects application.
```

```text
Document is incomplete.
```

Handling:

- jangan treat sebagai incident,
- jangan retry teknis,
- model sebagai BPMN path,
- simpan reason code,
- kirim ke user correction atau rejection path,
- audit decision.

### 4.3 Kenapa Ini Penting

Jika business failure dijadikan technical incident, operator akan dipaksa memperbaiki sesuatu yang sebenarnya bukan rusak.

Jika technical failure dijadikan business rejection, user bisa dirugikan.

Contoh fatal:

```text
Risk scoring API down
  -> sistem menganggap applicant high risk
  -> application rejected
```

Ini salah. API down bukan bukti applicant high risk.

Desain yang lebih benar:

```text
Risk scoring API down
  -> retry/backoff
  -> incident atau manual assessment queue
```

---

## 5. BPMN Error

BPMN error adalah mekanisme untuk memberi tahu process model bahwa sebuah aktivitas menghasilkan kondisi error yang bermakna secara proses.

BPMN error bukan sinonim dari Java exception.

Mental model:

```text
BPMN error = named business/process exception that the BPMN model is expected to catch and route.
```

Contoh BPMN error:

```text
PAYMENT_DECLINED
DOCUMENT_INVALID
APPLICANT_INELIGIBLE
EXTERNAL_RECORD_NOT_FOUND
DUPLICATE_APPLICATION
```

Bukan contoh BPMN error yang baik:

```text
NullPointerException
SocketTimeoutException
SQLException
JsonProcessingException
```

Itu technical exception.

### 5.1 Error Boundary Event

Error boundary event ditempel pada activity/subprocess.

Jika activity melempar BPMN error dan boundary event matching error code, token keluar ke jalur error.

Contoh:

```text
[Validate Application]
    |
    | success
    v
[Continue Assessment]

Boundary Error: APPLICATION_INVALID
    |
    v
[Request Correction]
```

Maknanya:

```text
Validasi gagal adalah kemungkinan bisnis yang diantisipasi.
Proses tidak stuck.
Proses pindah ke correction path.
```

### 5.2 Error Event Subprocess

Error event subprocess cocok untuk menangkap error di scope lebih luas.

Contoh:

```text
Application Assessment Subprocess
  - check eligibility
  - check documents
  - check risk
  - calculate fee

Error Event Subprocess catches APPLICATION_REJECTABLE
  -> prepare rejection notice
  -> end assessment
```

Gunakan ketika beberapa activity dalam scope bisa menghasilkan jenis error yang sama dan jalur penanganannya seragam.

### 5.3 Throw BPMN Error dari Java Worker

Dalam Camunda 8, worker dapat memberi sinyal BPMN error melalui API throw error. Ini berbeda dari fail job.

Konsep:

```text
fail job
  -> technical failure
  -> retry/incident

throw BPMN error
  -> business/process exception
  -> BPMN boundary/event subprocess handles it
```

Pseudo-code:

```java
try {
    PaymentResult result = paymentClient.charge(command);

    if (result.declined()) {
        client.newThrowErrorCommand(job.getKey())
              .errorCode("PAYMENT_DECLINED")
              .errorMessage(result.reason())
              .send()
              .join();
        return;
    }

    client.newCompleteCommand(job.getKey())
          .variables(Map.of(
              "paymentStatus", "CAPTURED",
              "paymentReference", result.reference()
          ))
          .send()
          .join();

} catch (PaymentProviderTimeoutException e) {
    client.newFailCommand(job.getKey())
          .retries(job.getRetries() - 1)
          .errorMessage("Payment provider timeout")
          .retryBackoff(Duration.ofMinutes(2))
          .send()
          .join();
}
```

Perhatikan:

- declined = BPMN error,
- timeout = fail job/retry,
- captured = complete job.

---

## 6. `failJob` vs `throwError` vs `completeJob`

Ini decision matrix penting.

| Worker outcome | API action | BPMN meaning | Runtime consequence |
|---|---|---|---|
| Work succeeded | complete job | activity complete | token continues normal path |
| Technical failure, retry possible | fail job with retries > 0 | activity not complete | job retried later |
| Technical failure, retry exhausted | fail job with retries = 0 | activity stuck | incident |
| Business/process error | throw BPMN error | alternative BPMN path | boundary/event subprocess catches |
| Fatal bug/config issue | fail job to incident | operator repair needed | stuck until fixed |

Rule of thumb:

```text
If the BPMN model should know and route it, throw BPMN error.
If the operation should be tried again or repaired, fail job.
If the work is done, complete job.
```

---

## 7. Incident

Incident adalah operational failure object.

Dalam workflow production, incident sangat penting karena ia menjawab:

```text
Process mana yang stuck?
Di activity mana?
Kenapa?
Apa yang harus diperbaiki?
Bisakah kita retry setelah fix?
```

Incident bukan business rejection.

### 7.1 Kapan Incident Terjadi

Di Camunda 8, incident dapat dibuat ketika, misalnya:

- job failed dan retries habis,
- gateway condition/expression invalid,
- timer expression invalid,
- decision evaluation gagal,
- BPMN error dilempar tetapi tidak ada catcher yang cocok.

### 7.2 Incident as Safety Brake

Incident adalah rem keamanan.

Lebih baik process stuck sebagai incident daripada diam-diam mengambil keputusan salah.

Contoh:

```text
Eligibility rule service response schema berubah.
Worker gagal parse response.
```

Jangan default ke eligible atau not eligible. Jadikan technical failure. Retry jika mungkin. Jika habis, incident.

### 7.3 Incident Handling Flow

Runbook incident umumnya:

```text
1. Identify process instance.
2. Identify failed element.
3. Read incident message.
4. Classify failure.
5. Check side effect status.
6. Fix root cause.
7. Correct variable if needed.
8. Increase retries / resolve incident.
9. Monitor continuation.
10. Record repair action.
```

### 7.4 Incident yang Buruk

Incident buruk adalah incident yang tidak memberi informasi.

Contoh buruk:

```text
Error occurred
```

Contoh baik:

```text
PAYMENT_PROVIDER_TIMEOUT: provider=ABC, operation=capture, idempotencyKey=PAY-2026-000123, httpStatus=504, attempt=3/5, nextAction=retry_after_provider_recovery
```

Incident message harus membantu operator, bukan hanya developer.

---

## 8. Escalation

Escalation berbeda dari error.

Escalation biasanya berarti:

```text
Ada kondisi non-fatal yang perlu diketahui atau ditangani scope lebih tinggi.
```

Camunda mendeskripsikan escalation event sebagai event yang merujuk named escalation dan digunakan untuk berkomunikasi ke higher flow scope; berbeda dari error, escalation bersifat non-critical dan execution bisa tetap berjalan pada lokasi throwing.

### 8.1 Kapan Memakai Escalation

Gunakan escalation untuk:

- SLA warning,
- approval tidak direspons,
- perlu supervisor awareness,
- risk threshold naik,
- review tambahan diperlukan,
- case perlu diprioritaskan.

Jangan gunakan escalation untuk:

- network timeout murni,
- data corruption,
- retry exhaustion,
- NullPointerException,
- DB down.

Itu technical failure/incident.

### 8.2 Interrupting vs Non-interrupting Escalation

Dalam modeling, escalation bisa dipakai dengan boundary/event semantics.

Mental model:

```text
Non-interrupting escalation:
  Aktivitas utama tetap berjalan,
  jalur escalation juga berjalan.

Interrupting escalation:
  Aktivitas utama dihentikan,
  token pindah ke jalur escalation.
```

Contoh non-interrupting:

```text
Officer Review masih berjalan,
tetapi setelah 3 hari supervisor diberi notification.
```

Contoh interrupting:

```text
Officer Review melewati deadline final,
task officer dibatalkan,
case dialihkan ke supervisor.
```

### 8.3 Escalation vs Timer

Timer adalah pemicu waktu.
Escalation adalah makna proses.

Sering keduanya digabung:

```text
Timer boundary event fires after 3 days
  -> throw escalation REVIEW_DELAYED
  -> notify supervisor
```

Atau lebih sederhana:

```text
Timer boundary on User Task
  -> Create Supervisor Task
```

Tidak semua timer harus disebut escalation. Jika hanya reminder, cukup timer path. Jika ada konsep bisnis “escalated”, maka modelkan escalation/status/audit secara eksplisit.

---

## 9. Compensation

Compensation adalah salah satu konsep paling sering disalahpahami.

Banyak engineer menyamakan compensation dengan rollback. Ini keliru.

```text
Rollback = membatalkan perubahan dalam transaksi teknis yang belum commit.
Compensation = membuat aksi bisnis baru untuk membalik/mengoreksi efek yang sudah committed.
```

Jika transfer uang sudah terjadi, Anda tidak bisa “rollback transaction” di database sendiri. Anda harus membuat transaksi bisnis baru: refund/reversal.

### 9.1 Kapan Compensation Dibutuhkan

Compensation dibutuhkan ketika:

1. step A sudah sukses,
2. side effect A sudah visible/committed,
3. step B/C kemudian gagal atau proses dibatalkan,
4. business mengharuskan efek A dibalik/dikoreksi.

Contoh:

```text
Reserve inspection slot -> success
Generate invoice -> success
Payment capture -> failed permanently
```

Mungkin perlu:

```text
Cancel inspection slot
Void invoice
Notify applicant
```

### 9.2 Compensation Handler

Dalam BPMN, compensation handler diasosiasikan dengan activity yang sudah complete.

Mental model:

```text
Activity completed successfully
  -> compensation handler becomes eligible

Later compensation throw event occurs
  -> eligible compensation handlers invoked
```

Camunda docs menjelaskan bahwa ketika process instance mencapai compensation throw event, compensation handler untuk activity yang sudah selesai akan dipanggil; jika activity selesai beberapa kali, compensation handler dipanggil sejumlah itu.

### 9.3 Compensation Harus Idempotent

Compensation juga side effect. Jadi compensation harus idempotent.

Contoh:

```text
Cancel booking
```

Jika dijalankan dua kali:

- pertama: booking canceled,
- kedua: booking already canceled.

Kedua eksekusi tidak boleh membuat error fatal yang merusak proses.

Pseudo-code:

```java
CancelResult result = bookingClient.cancel(bookingReference, cancellationKey);

if (result.cancelled() || result.alreadyCancelled()) {
    completeJob(job, Map.of("bookingCancellationStatus", "CANCELLED"));
    return;
}

if (result.notFound()) {
    // depending on business meaning, maybe treat as already compensated
    completeJob(job, Map.of("bookingCancellationStatus", "NOT_FOUND_ASSUMED_COMPENSATED"));
    return;
}

failJobWithBackoff(job, "Booking cancellation failed");
```

### 9.4 Compensation Tidak Selalu Mengembalikan Dunia ke State Awal

Ini sangat penting.

Compensation bukan time machine.

Jika email sudah terkirim, Anda tidak bisa menarik email dari pikiran penerima. Compensation-nya mungkin:

```text
Send correction email
```

Jika license sudah diterbitkan dan dilihat applicant, compensation-nya mungkin:

```text
Revoke license
Record revocation reason
Notify applicant
```

Jika payment sudah captured, compensation-nya:

```text
Refund payment
```

Bukan menghapus row payment.

### 9.5 Forward Recovery vs Backward Recovery

Ada dua pendekatan:

```text
Backward recovery:
  Batalkan step yang sudah sukses.

Forward recovery:
  Lanjutkan proses dengan repair/adjustment sampai mencapai outcome valid.
```

Contoh backward:

```text
Payment captured, license generation fails permanently
  -> refund payment
```

Contoh forward:

```text
Payment captured, license generation service down
  -> retry/generate later
```

Jangan otomatis compensate hanya karena step berikutnya gagal. Jika failure transient, forward recovery sering lebih benar.

---

## 10. Cancellation, Termination, and Compensation

Cancellation dan compensation sering bercampur.

### 10.1 Cancellation

Cancellation berarti proses/aktivitas dihentikan.

Contoh:

```text
Applicant withdraws application.
```

Akibatnya:

- user task dibatalkan,
- pending timers dibatalkan,
- process path menuju withdrawal handling,
- completed side effects mungkin perlu compensation.

### 10.2 Terminate End Event

Terminate end event menghentikan semua token dalam scope tertentu.

Gunakan hati-hati.

Cocok untuk:

- process harus selesai total,
- semua cabang paralel harus dihentikan,
- tidak ada action lanjut yang boleh berjalan.

Risiko:

- token lain mati tanpa explicit business handling,
- audit bisa kurang jelas,
- compensation tidak otomatis terjadi kecuali dimodelkan.

### 10.3 Compensation Setelah Cancellation

Jika cancellation terjadi setelah side effect sukses, perlu pertanyaan:

```text
Side effect mana yang harus dibatalkan?
Mana yang tetap valid?
Mana yang perlu notification?
Mana yang perlu record audit?
```

Contoh:

```text
Application withdrawn after payment captured
```

Kemungkinan flow:

```text
Withdraw requested
  -> cancel pending review tasks
  -> refund payment if refundable
  -> mark application WITHDRAWN
  -> notify applicant
  -> audit withdrawal reason
```

---

## 11. Retry Design

Retry adalah pisau bermata dua.

Retry bisa meningkatkan reliability, tetapi juga bisa:

- memperparah overload,
- membuat duplicate side effect,
- menyembunyikan bug,
- memperlambat incident detection,
- membuat external provider marah karena rate limit.

### 11.1 Retry Classification

Sebelum retry, klasifikasikan failure.

| Failure | Retry? | Reason |
|---|---:|---|
| HTTP 502 | Ya | transient gateway failure |
| HTTP 503 | Ya | service unavailable |
| HTTP 504 | Ya, hati-hati | timeout, side effect ambiguous |
| HTTP 429 | Ya dengan backoff | rate limited |
| HTTP 400 | Tidak | bad request/config/data |
| HTTP 401 | Tidak langsung | credential issue; refresh token jika valid |
| HTTP 403 | Tidak | permission/config issue |
| HTTP 404 | Depends | resource absent bisa business outcome |
| DB deadlock | Ya | transient concurrency |
| Unique constraint | Depends | duplicate/idempotency issue |
| JSON schema mismatch | Tidak | code/schema defect |

### 11.2 Backoff

Backoff memberi waktu external dependency pulih.

Contoh:

```text
Attempt 1: immediate
Attempt 2: after 30 sec
Attempt 3: after 2 min
Attempt 4: after 10 min
Attempt 5: incident
```

Dalam Camunda 8, saat failing job, worker dapat menentukan retry backoff agar retry ditunda; ini berguna misalnya ketika external system sedang down sehingga retry segera tidak berguna.

### 11.3 Retry Exhaustion

Retry exhaustion harus menghasilkan tindakan yang jelas.

```text
Retries exhausted
  -> incident
  -> alert
  -> runbook
  -> repair
  -> retry/resolution
```

Jangan biarkan retry habis tanpa observability.

---

## 12. Failure Window: Side Effect Sukses, Complete Job Gagal

Ini skenario sangat penting.

```text
Worker activates job
Worker calls external system
External system succeeds
Worker sends completeJob to Camunda
Network fails before complete acknowledged
Job timeout expires
Another worker picks same job
```

Jika worker tidak idempotent, external call bisa dilakukan dua kali.

Solusi:

1. external idempotency key,
2. local command table,
3. external status check,
4. complete job using recorded result,
5. do not repeat unsafe side effect blindly.

Pattern:

```text
Before side effect:
  insert command record with idempotency key

Call external system:
  use same idempotency key

After success:
  store external reference

If duplicate job:
  detect command already succeeded
  complete job with existing result
```

Pseudo-table:

```sql
CREATE TABLE workflow_command_dedup (
    idempotency_key      VARCHAR(200) PRIMARY KEY,
    process_instance_key VARCHAR(100) NOT NULL,
    element_instance_key VARCHAR(100) NOT NULL,
    job_type             VARCHAR(100) NOT NULL,
    command_status       VARCHAR(30) NOT NULL,
    external_reference   VARCHAR(200),
    request_hash         VARCHAR(128) NOT NULL,
    response_payload     CLOB,
    created_at           TIMESTAMP NOT NULL,
    updated_at           TIMESTAMP NOT NULL
);
```

Pseudo-flow:

```text
Job received
  -> derive idempotency key
  -> find command record
       -> SUCCEEDED? complete job with stored result
       -> IN_PROGRESS too old? reconcile external status
       -> not found? create command record
  -> call external
  -> persist result
  -> complete job
```

---

## 13. BPMN Error Code Design

BPMN error code harus stabil dan bermakna.

Jangan gunakan raw exception class sebagai error code.

Buruk:

```text
java.lang.IllegalArgumentException
HttpClientErrorException$BadRequest
NullPointerException
```

Baik:

```text
APPLICATION_INVALID
PAYMENT_DECLINED
DOCUMENT_INCOMPLETE
APPLICANT_NOT_ELIGIBLE
DUPLICATE_APPLICATION
EXTERNAL_RECORD_NOT_FOUND
```

### 13.1 Naming Convention

Gunakan style konsisten:

```text
<DOMAIN>_<CONDITION>
```

Contoh:

```text
PAYMENT_DECLINED
PAYMENT_NOT_REFUNDABLE
DOCUMENT_INCOMPLETE
DOCUMENT_EXPIRED
APPLICATION_DUPLICATE
APPLICANT_INELIGIBLE
CASE_ALREADY_CLOSED
```

### 13.2 Error Payload

Error code harus disertai detail variable seperlunya.

```json
{
  "errorCode": "DOCUMENT_INCOMPLETE",
  "reasonCode": "MISSING_DIRECTOR_DECLARATION",
  "missingDocuments": ["DIRECTOR_DECLARATION"],
  "detectedAt": "2026-06-17T10:15:00+07:00"
}
```

Jangan memasukkan data sensitif berlebihan.

---

## 14. Business Exception Modeling Patterns

### 14.1 Validation Error to Correction Path

```text
[Validate Submission]
   | success
   v
[Proceed Assessment]

Boundary Error: SUBMISSION_INVALID
   |
   v
[Request Applicant Correction]
   |
   v
[Wait Resubmission]
   |
   v
[Validate Submission]
```

Ini cocok untuk data yang bisa diperbaiki.

### 14.2 Eligibility Error to Rejection Path

```text
[Check Eligibility]
   | eligible
   v
[Continue]

Boundary Error: APPLICANT_INELIGIBLE
   |
   v
[Prepare Rejection Notice]
   |
   v
[Notify Applicant]
   |
   v
[End Rejected]
```

Ini cocok ketika tidak ada correction path.

### 14.3 External Not Found

`NOT_FOUND` ambiguous.

Contoh:

```text
Company registry returns 404
```

Bisa berarti:

- company genuinely not found -> business error,
- wrong endpoint/config -> technical incident,
- stale identifier -> correction path,
- registry unavailable returns wrong status -> technical failure.

Jangan map HTTP 404 otomatis ke BPMN error tanpa domain understanding.

---

## 15. Technical Failure Modeling Patterns

### 15.1 Retry Then Incident

```text
[Call External Registry]
   |
   | technical failure
   v
retry with backoff
   |
   | retries exhausted
   v
incident
```

Ini biasanya bukan terlihat sebagai explicit BPMN branch. Ini terjadi di job worker/runtime.

### 15.2 Retry Then Manual Technical Review

Kadang setelah retry habis, bukan hanya incident, tetapi perlu business-visible manual path.

Contoh:

```text
Automated risk scoring unavailable
```

Setelah retry habis, organization mungkin memilih:

```text
Manual Risk Assessment Task
```

Ada dua cara:

1. Technical incident dulu, operator fix/retry.
2. Worker melempar BPMN error `AUTO_RISK_SCORING_UNAVAILABLE` setelah policy retry tertentu, lalu proses masuk manual assessment.

Pilih berdasarkan business policy.

Jika external system down seharusnya tidak menghentikan business process, manual path valid. Jika data wajib dari external system dan tidak boleh diganti manual, incident lebih tepat.

### 15.3 Circuit Breaker + BPMN Path

Jika dependency down luas, retry ribuan process bisa memperparah keadaan.

Pattern:

```text
Worker checks circuit breaker
  -> CLOSED: call external
  -> OPEN: fail job with long backoff OR throw business-process unavailable path depending policy
```

Untuk proses regulatory, biasanya hati-hati:

- jika data eksternal wajib, incident/backoff,
- jika manual verification allowed, route to manual task.

---

## 16. Escalation Modeling Patterns

### 16.1 Reminder Without Escalated Ownership

```text
[Officer Review]
  boundary non-interrupting timer: after 2 days
      -> [Send Reminder]
```

Task tetap di officer.

### 16.2 Supervisor Notification

```text
[Officer Review]
  boundary non-interrupting timer: after 3 days
      -> [Notify Supervisor]
```

Officer task tetap aktif, supervisor aware.

### 16.3 Reassignment

```text
[Officer Review]
  boundary interrupting timer: after 5 days
      -> [Create Supervisor Review Task]
```

Officer task dibatalkan, supervisor mengambil alih.

### 16.4 Escalation Event Subprocess

Untuk scope besar:

```text
Assessment Subprocess
  event subprocess catches REVIEW_DELAYED
      -> create escalation record
      -> notify team lead
```

Cocok ketika escalation bisa terjadi dari beberapa activity.

---

## 17. Compensation Modeling Patterns

### 17.1 Payment + License Generation

```text
[Capture Payment]
   compensation handler -> [Refund Payment]
      |
      v
[Generate License]
      |
      | fails permanently
      v
[Throw Compensation]
      |
      v
[Notify Applicant]
```

Jika payment sudah captured tetapi license tidak bisa dibuat, refund mungkin diperlukan.

### 17.2 Reservation + Approval Failure

```text
[Reserve Inspection Slot]
  compensation handler -> [Cancel Inspection Slot]
      |
      v
[Supervisor Approval]
      |
      | rejected
      v
[Throw Compensation]
      |
      v
[Notify Rejection]
```

### 17.3 Document Generation Correction

```text
[Generate Certificate]
  compensation handler -> [Revoke Certificate]
      |
      v
[Publish Certificate]
      |
      v
[Later discovered invalid data]
      |
      v
[Throw Compensation]
      |
      v
[Generate Corrected Certificate]
```

Di sini compensation bukan delete certificate. Ini revoke + corrected issuance.

---

## 18. Error Propagation Across Subprocess

Subprocess memperkenalkan scope.

Mental model:

```text
Inner activity throws error
  -> nearest matching boundary/event subprocess catches it
  -> if not caught in inner scope, propagate outward
  -> if never caught, incident can occur
```

### 18.1 Local Catch

```text
Document Check Subprocess
  [Validate Documents]
    throws DOCUMENT_INCOMPLETE
  Error boundary on Validate Documents catches it
```

Cocok jika handling spesifik activity.

### 18.2 Subprocess-level Catch

```text
Document Check Subprocess
  - validate identity document
  - validate financial document
  - validate declaration

Error boundary on subprocess catches DOCUMENT_INCOMPLETE
```

Cocok jika semua document validation error menuju path sama.

### 18.3 Parent-level Catch

```text
Application Assessment Process
  Call Activity: Risk Assessment
    throws HIGH_RISK_REJECTION

Parent process catches and routes to rejection notice.
```

Cocok jika child process reusable tetapi parent menentukan consequence.

---

## 19. Interrupting vs Non-interrupting Boundary Events

Boundary event bisa interrupting atau non-interrupting.

### 19.1 Interrupting

Makna:

```text
Saat event terjadi, activity utama dihentikan.
```

Contoh:

```text
Applicant does not submit correction within 14 days.
Correction task cancelled.
Application expires.
```

### 19.2 Non-interrupting

Makna:

```text
Saat event terjadi, activity utama tetap berjalan.
Jalur tambahan juga berjalan.
```

Contoh:

```text
Officer review belum selesai setelah 3 hari.
Send reminder, tetapi review task tetap aktif.
```

### 19.3 Kesalahan Umum

Kesalahan besar:

```text
Menggunakan non-interrupting timer untuk expiry final.
```

Akibatnya:

- expiry path berjalan,
- original task tetap bisa diselesaikan,
- process bisa punya outcome konflik.

Jika deadline final, gunakan interrupting path atau guard state di domain.

---

## 20. Domain State vs Process Failure

Workflow engine mengatur process state. Domain database tetap harus melindungi invariant bisnis.

Contoh:

```text
Application status = EXPIRED
```

Jika officer task lama masih bisa menyelesaikan approval karena race condition, domain service harus menolak:

```java
if (application.isExpired()) {
    throw new BusinessRuleViolation("APPLICATION_ALREADY_EXPIRED");
}
```

BPMN membantu orkestrasi, tetapi domain tetap penjaga invariant.

Rule:

```text
Do not rely only on BPMN path to enforce domain invariants.
```

---

## 21. Manual Repair Design

Manual repair bukan afterthought.

Production workflow harus punya strategi repair.

### 21.1 Repairable vs Non-repairable Incident

| Incident | Repair action |
|---|---|
| Missing variable | add/correct variable |
| External system down | wait recovery, retry |
| Credential expired | rotate secret, retry |
| Bad BPMN expression | deploy fixed model, migrate/retry as applicable |
| Wrong business data | domain correction with audit, retry |
| Side effect ambiguous | reconcile external state, complete/fail accordingly |

### 21.2 Audit-safe Repair

Repair harus meninggalkan jejak.

Catat:

- siapa memperbaiki,
- kapan,
- process instance mana,
- variable apa yang diubah,
- alasan,
- approval repair jika high-risk,
- sebelum/sesudah,
- incident id/reference,
- runbook step.

### 21.3 Jangan Repair Diam-diam

Bad practice:

```sql
UPDATE process_variable SET value = 'APPROVED' WHERE ...
```

Tanpa audit, tanpa approval, tanpa reason.

Good practice:

```text
Use official operation tool/API
Record repair request
Require approval if material impact
Add audit event
Resolve incident
Monitor process continuation
```

---

## 22. Regulatory Case Example

Kita gunakan contoh proses enforcement/application management.

### 22.1 Process

```text
Start Application
  -> Validate Submission
  -> Collect Fee
  -> Assign Officer Review
  -> Risk Assessment
  -> Supervisor Approval
  -> Issue License
  -> Notify Applicant
  -> End
```

### 22.2 Failure Classification

| Step | Failure | Classification | Handling |
|---|---|---|---|
| Validate Submission | missing document | business validation | BPMN error to correction |
| Collect Fee | provider timeout | technical transient | fail job retry/backoff |
| Collect Fee | payment declined | business outcome | BPMN error to payment retry/user path |
| Officer Review | no action 3 days | SLA warning | non-interrupting timer/reminder |
| Officer Review | no action 7 days | SLA breach | interrupt/reassign/escalate |
| Risk Assessment | scoring API down | technical or manual fallback | retry then incident/manual assessment |
| Supervisor Approval | rejected | business decision | rejection path |
| Issue License | document service 503 | technical transient | retry/backoff |
| Issue License | license generated but notification fails | partial side effect | retry notification, maybe forward recovery |
| After payment | application withdrawn | business cancellation | compensation/refund if policy |

### 22.3 Text BPMN Sketch

```text
(Start)
  |
  v
[Validate Submission]
  |-- Error DOCUMENT_INCOMPLETE --> [Request Correction] --> [Wait Resubmission] --> [Validate Submission]
  |
  v
[Collect Fee]
  |-- Error PAYMENT_DECLINED --> [Ask Applicant to Retry Payment]
  |
  v
[Officer Review]
  |-- non-interrupting timer 3d --> [Send Reminder]
  |-- interrupting timer 7d --> [Supervisor Review]
  |
  v
[Risk Assessment]
  |-- Error MANUAL_ASSESSMENT_REQUIRED --> [Manual Risk Assessment]
  |
  v
[Supervisor Approval]
  |-- rejected --> [Prepare Rejection Notice] --> [Compensate If Needed] --> (Rejected)
  |
  v
[Issue License]
  |
  v
[Notify Applicant]
  |
  v
(Approved)
```

---

## 23. Java Worker Error Classification Pattern

A production worker should not blindly catch `Exception` and fail everything the same way.

### 23.1 Error Classifier

```java
public enum WorkerOutcomeType {
    SUCCESS,
    BUSINESS_ERROR,
    TECHNICAL_RETRYABLE,
    TECHNICAL_NON_RETRYABLE,
    AMBIGUOUS_SIDE_EFFECT
}
```

```java
public final class WorkerOutcome {
    private final WorkerOutcomeType type;
    private final String errorCode;
    private final String message;
    private final Map<String, Object> variables;
    private final Duration retryBackoff;

    // constructors/getters omitted
}
```

### 23.2 Handler Skeleton

```java
public void handle(JobClient client, ActivatedJob job) {
    String idempotencyKey = deriveIdempotencyKey(job);

    try {
        WorkerOutcome outcome = service.execute(job.getVariablesAsMap(), idempotencyKey);

        switch (outcome.getType()) {
            case SUCCESS:
                client.newCompleteCommand(job.getKey())
                      .variables(outcome.getVariables())
                      .send()
                      .join();
                return;

            case BUSINESS_ERROR:
                client.newThrowErrorCommand(job.getKey())
                      .errorCode(outcome.getErrorCode())
                      .errorMessage(outcome.getMessage())
                      .variables(outcome.getVariables())
                      .send()
                      .join();
                return;

            case TECHNICAL_RETRYABLE:
                client.newFailCommand(job.getKey())
                      .retries(Math.max(job.getRetries() - 1, 0))
                      .retryBackoff(outcome.getRetryBackoff())
                      .errorMessage(outcome.getMessage())
                      .send()
                      .join();
                return;

            case TECHNICAL_NON_RETRYABLE:
                client.newFailCommand(job.getKey())
                      .retries(0)
                      .errorMessage(outcome.getMessage())
                      .send()
                      .join();
                return;

            case AMBIGUOUS_SIDE_EFFECT:
                client.newFailCommand(job.getKey())
                      .retries(0)
                      .errorMessage("Ambiguous side effect. Manual reconciliation required. " + outcome.getMessage())
                      .send()
                      .join();
                return;

            default:
                throw new IllegalStateException("Unsupported outcome: " + outcome.getType());
        }

    } catch (KnownBusinessException e) {
        client.newThrowErrorCommand(job.getKey())
              .errorCode(e.errorCode())
              .errorMessage(e.getMessage())
              .variables(e.variables())
              .send()
              .join();

    } catch (TransientDependencyException e) {
        client.newFailCommand(job.getKey())
              .retries(Math.max(job.getRetries() - 1, 0))
              .retryBackoff(Duration.ofMinutes(2))
              .errorMessage(e.getMessage())
              .send()
              .join();

    } catch (Exception e) {
        client.newFailCommand(job.getKey())
              .retries(0)
              .errorMessage("Unexpected worker failure: " + e.getClass().getSimpleName() + ": " + e.getMessage())
              .send()
              .join();
    }
}
```

Catatan:

- contoh ini fokus konsep,
- production code perlu logging, tracing, timeout, idempotency repository, error sanitization,
- jangan expose PII/secrets di `errorMessage`.

---

## 24. Error Message Hygiene

Error message masuk observability/operate/history/log. Jangan sembarangan.

### 24.1 Jangan Masukkan

- password,
- token,
- full NRIC/KTP/passport,
- full card number,
- raw request payload sensitif,
- database connection string,
- secret name yang terlalu detail,
- private key/certificate content.

### 24.2 Masukkan

- stable error code,
- external system name,
- operation name,
- sanitized status code,
- correlation id,
- idempotency key,
- business reference,
- retry attempt,
- recommended next action.

Contoh:

```text
REGISTRY_LOOKUP_TIMEOUT: system=CompanyRegistry, operation=lookupCompany, businessRef=APP-2026-00091, correlationId=..., attempt=3/5, nextAction=retry_after_dependency_recovery
```

---

## 25. Observability untuk Failure

Failure handling tanpa observability tidak bisa dioperasikan.

Minimal metrics:

```text
workflow_worker_job_completed_total{jobType}
workflow_worker_job_failed_total{jobType,errorClass}
workflow_worker_bpmn_error_total{jobType,errorCode}
workflow_worker_incident_total{processId,elementId}
workflow_worker_retry_exhausted_total{jobType}
workflow_worker_compensation_started_total{compensationType}
workflow_worker_compensation_failed_total{compensationType}
workflow_sla_escalation_total{processId,escalationCode}
```

Minimal log fields:

```text
processInstanceKey
processDefinitionId
elementId
elementInstanceKey
jobKey
jobType
businessKey
correlationId
idempotencyKey
errorCode
errorClass
retryRemaining
externalSystem
externalReference
```

Minimal alert:

```text
incident count > threshold
retry exhaustion spike
same job type failing across many instances
same external system timeout spike
compensation failure > 0 for critical process
SLA escalation spike
```

---

## 26. Common Anti-patterns

### 26.1 Semua Exception Jadi BPMN Error

Buruk:

```text
catch Exception -> throw BPMN error SYSTEM_ERROR
```

Akibat:

- technical bug masuk business path,
- process bisa lanjut salah,
- incident tidak muncul,
- operator tidak tahu ada sistem rusak.

### 26.2 Semua Business Outcome Jadi Incident

Buruk:

```text
payment declined -> fail job -> incident
```

Akibat:

- operator disuruh memperbaiki kartu applicant,
- business flow macet,
- metrics incident misleading.

### 26.3 Retry Tanpa Idempotency

Buruk:

```text
timeout after payment capture -> retry capture -> double charge
```

### 26.4 Compensation Sebagai Delete Row

Buruk:

```sql
DELETE FROM license WHERE license_id = ?
```

Lebih baik:

```text
Create revocation record
Mark license revoked
Notify affected parties
Keep audit trail
```

### 26.5 Non-interrupting Timer untuk Deadline Final

Akibat:

- deadline path dan normal completion path bisa sama-sama berjalan,
- outcome konflik.

### 26.6 Incident Tanpa Runbook

Incident tanpa runbook hanya memindahkan masalah dari runtime ke manusia.

### 26.7 Error Code Tidak Stabil

Buruk:

```text
PAYMENT_ERROR_1
PAYMENT_ERROR_2
ERR_XYZ
```

Error code harus menjadi domain/process contract.

---

## 27. Design Checklist

Gunakan checklist ini sebelum production.

### 27.1 Failure Classification

- Apakah setiap external call punya classification failure?
- Apakah business rejection dibedakan dari technical failure?
- Apakah validation failure punya correction/rejection path?
- Apakah ambiguous side effect punya reconciliation path?

### 27.2 Retry

- Apakah retry hanya untuk transient failure?
- Apakah retry punya backoff?
- Apakah retry count sesuai criticality?
- Apakah retry exhaustion menghasilkan incident/alert?
- Apakah worker idempotent?

### 27.3 BPMN Error

- Apakah BPMN error code stabil?
- Apakah setiap thrown BPMN error punya catcher?
- Apakah uncaught BPMN error disengaja?
- Apakah error variable cukup tapi tidak berlebihan?

### 27.4 Incident

- Apakah incident message operator-friendly?
- Apakah ada runbook?
- Apakah repair action audited?
- Apakah variable correction dikontrol?

### 27.5 Escalation

- Apakah SLA warning dan SLA breach dibedakan?
- Apakah interrupting/non-interrupting sudah benar?
- Apakah ownership setelah escalation jelas?
- Apakah escalation tercatat sebagai business event?

### 27.6 Compensation

- Apakah side effect yang butuh compensation sudah diidentifikasi?
- Apakah compensation idempotent?
- Apakah compensation failure punya handling?
- Apakah compensation tidak menghapus audit trail?
- Apakah forward recovery dipertimbangkan sebelum backward compensation?

### 27.7 Security and Data

- Apakah error message bebas secret/PII?
- Apakah repair operation authorized?
- Apakah compensation high-impact perlu approval?
- Apakah logs aman?

---

## 28. Decision Matrix Ringkas

| Situation | Recommended handling |
|---|---|
| External API timeout before known side effect | fail job retry/backoff |
| External API timeout after possible side effect | reconcile/idempotency, maybe incident |
| Payment declined | BPMN error/business path |
| Applicant invalid | BPMN error/correction or rejection |
| DB temporarily unavailable | fail job retry/backoff |
| DTO schema mismatch | fail job to incident |
| Gateway FEEL invalid | incident/fix model or variable |
| Officer late 3 days | non-interrupting timer/reminder/escalation |
| Officer late final deadline | interrupting timer/reassign/cancel path |
| Application withdrawn after payment | cancellation + compensation/refund policy |
| License issued from wrong data | compensation/revocation/correction process |
| Worker crash after external success | idempotency dedup + complete with stored result |

---

## 29. Top 1% Engineering Heuristics

1. **Never retry what you cannot safely repeat.**
2. **Never model technical outage as business rejection.**
3. **Never send business rejection to operator as incident.**
4. **Never compensate before checking whether forward recovery is better.**
5. **Never throw BPMN error without a modeled catcher unless incident is intended.**
6. **Never hide side effect ambiguity. Reconcile it explicitly.**
7. **Never use process variables as repair dumping ground.**
8. **Never make escalation ambiguous about ownership.**
9. **Never let error messages leak secrets.**
10. **Never deploy workflow without runbook for stuck instances.**

---

## 30. Minimal Production Pattern

A reliable workflow service needs:

```text
BPMN model
  - business error paths
  - timer/escalation paths
  - compensation paths where needed

Java workers
  - idempotency
  - error classification
  - retry/backoff
  - BPMN error throwing
  - incident-friendly failure messages

Domain services
  - invariant checks
  - side effect records
  - compensation commands
  - audit trail

Operations
  - Operate/monitoring
  - logs/metrics/traces
  - incident runbook
  - repair authorization
  - manual reconciliation
```

This is the difference between “BPMN tutorial project” and “workflow platform that survives production”.

---

## 31. Summary

Di Part 9 ini, inti yang harus dibawa adalah:

```text
Not every failure is an exception.
Not every exception is technical.
Not every technical failure should become business path.
Not every business failure should become incident.
Not every completed side effect can be rolled back.
```

BPMN/Camunda memberi banyak mekanisme:

- failed job,
- retry,
- retry backoff,
- incident,
- BPMN error,
- boundary event,
- event subprocess,
- escalation,
- timer,
- compensation.

Namun kualitas sistem ditentukan oleh **classification discipline**.

Jika classification benar, workflow menjadi:

- reliable,
- observable,
- repairable,
- auditable,
- defensible,
- maintainable.

Jika classification salah, workflow menjadi:

- stuck tanpa alasan jelas,
- silent wrong decision,
- duplicate side effect,
- operator burden,
- audit nightmare.

---

## 32. Checklist Pemahaman

Anda dianggap memahami bagian ini jika bisa menjawab:

1. Apa perbedaan `failJob` dan `throwError`?
2. Kapan payment declined menjadi BPMN error?
3. Kapan timeout menjadi incident?
4. Kenapa compensation bukan rollback?
5. Apa risiko retry tanpa idempotency?
6. Apa beda escalation dan error?
7. Apa beda interrupting dan non-interrupting boundary timer?
8. Bagaimana mendesain incident message yang membantu operator?
9. Bagaimana menangani side effect sukses tetapi complete job gagal?
10. Bagaimana membuat compensation idempotent?

---

## 33. Referensi Konseptual yang Relevan

- Camunda 8 documentation — Dealing with problems and exceptions.
- Camunda 8 documentation — Job workers, failure, retry, retry backoff.
- Camunda 8 documentation — Incidents.
- Camunda 8 documentation — BPMN compensation events and compensation handlers.
- Camunda 8 documentation — BPMN escalation events.
- BPMN 2.0 concepts — error, escalation, compensation, timer, boundary events, subprocess scope.

---

# Status Seri

Selesai sejauh ini:

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

Berikutnya:

- Part 10 — Human Workflow: User Task, Assignment, Forms, SLA, and Authorization

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Learn Java BPMN & Camunda Process Orchestration Engineering](./learn-java-bpmn-camunda-part-08-process-variables-data-contract-scope-serialization-governance.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-10-human-workflow-user-task-assignment-forms-sla-authorization.md)

</div>