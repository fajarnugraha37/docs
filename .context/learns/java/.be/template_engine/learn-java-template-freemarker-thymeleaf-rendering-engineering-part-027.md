# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-027

# Part 27 — Advanced Integration Patterns: MVC, REST, Batch, Messaging, BPMN, and Case Management

## 0. Posisi Part Ini dalam Series

Pada part sebelumnya kita sudah membangun fondasi besar:

- FreeMarker sebagai engine general-purpose untuk output teks/HTML/XML/email/document pre-rendering.
- Thymeleaf sebagai engine DOM/natural-template untuk HTML server-side rendering.
- data model design sebagai kontrak rendering.
- template versioning dan governance.
- security beyond XSS, termasuk SSTI, sandbox, dan data leakage.
- testing strategy.
- production rendering service.

Part ini naik satu layer: **bagaimana template rendering dipasang ke workflow enterprise nyata**.

Di production, template jarang berdiri sendiri. Template biasanya dipanggil dari:

- MVC controller untuk render page.
- REST endpoint untuk preview/download artifact.
- batch job untuk generate ribuan email/dokumen.
- message consumer untuk asynchronous notification.
- BPMN process untuk service task/user task notification.
- case management lifecycle untuk surat keputusan, warning, reminder, escalation, closure notice.
- audit/correspondence subsystem untuk output yang harus defensible.

Jadi inti part ini:

> Template engine bukan hanya library render string. Dalam sistem enterprise, template engine adalah **artifact generation boundary** yang harus dipasang ke transaction boundary, workflow boundary, security boundary, audit boundary, dan failure boundary dengan benar.

---

## 1. Mental Model Utama: Rendering sebagai Side Effect Terkontrol

Secara sederhana:

```text
Business Event / User Request / Process Step
        |
        v
Collect Data + Select Template + Build ViewModel
        |
        v
Render Artifact
        |
        v
Deliver / Store / Attach / Display / Audit
```

Tetapi di production, setiap panah mengandung risiko.

### 1.1 Rendering bukan business decision

Rendering tidak boleh menentukan keputusan domain utama.

Buruk:

```text
Template decides whether application is approved.
```

Baik:

```text
Domain/workflow decides application is approved.
Template only renders approval notice based on already-decided state.
```

Template boleh melakukan presentation-level conditional:

```text
If appeal deadline exists, show appeal section.
If attachment list is empty, show no attachments note.
If recipient is organization, use organization salutation.
```

Template tidak boleh melakukan domain-level decision:

```text
If applicant score > 70, approve.
If outstanding amount > 10000, escalate.
If compliance history has 3 offences, issue warning.
```

Rule praktis:

> Jika logic tersebut mengubah state, hak, kewajiban, SLA, status, routing, atau legal meaning, itu bukan logic template.

### 1.2 Rendering adalah side effect karena menghasilkan artifact

Rendering menghasilkan sesuatu yang bisa berdampak nyata:

- HTML page dilihat user.
- email dikirim ke recipient.
- PDF menjadi legal notice.
- generated XML dikirim ke external system.
- generated CSV menjadi input downstream.
- generated letter masuk correspondence history.

Maka rendering harus dipandang sebagai side effect yang perlu:

- input jelas,
- output jelas,
- error model jelas,
- audit jelas,
- retry policy jelas,
- idempotency jelas,
- security control jelas.

### 1.3 Tiga mode integrasi utama

Ada tiga cara besar template engine dipakai.

#### Mode A — Inline synchronous rendering

Contoh:

```text
HTTP request -> controller -> render page -> HTTP response
```

Cocok untuk:

- page rendering,
- preview kecil,
- email preview,
- synchronous download artifact kecil.

Risiko:

- rendering menjadi bagian latency user request,
- error langsung terlihat user,
- data access harus cepat,
- tidak cocok untuk output besar/batch.

#### Mode B — Synchronous command artifact generation

Contoh:

```text
POST /cases/{id}/notice
  -> validate command
  -> render PDF
  -> store document
  -> return document id
```

Cocok untuk:

- user meminta generate dokumen sekarang,
- output harus tersedia sebelum response selesai,
- volume rendah/sedang.

Risiko:

- transaction boundary rumit,
- PDF generation bisa lambat,
- retry di client bisa menggandakan dokumen kalau tidak idempotent.

#### Mode C — Asynchronous rendering

Contoh:

```text
CaseApproved event -> outbox -> message broker -> renderer worker -> generate email/PDF -> send/store
```

Cocok untuk:

- email notification,
- correspondence batch,
- SLA reminder,
- escalation notices,
- report/doc generation berat,
- workflow service task yang bisa berjalan async.

Risiko:

- eventual consistency,
- duplicate messages,
- retry semantics,
- poison message,
- template/model version drift,
- traceability.

---

## 2. Integration Pattern 1: MVC Page Rendering

MVC adalah integrasi paling klasik untuk Thymeleaf dan juga bisa memakai FreeMarker.

### 2.1 Bentuk pipeline MVC

```text
Browser
  -> GET /applications/{id}
  -> Controller
  -> Query application read model
  -> Build page view model
  -> Return view name + model
  -> Template engine render HTML
  -> HTTP response
```

Contoh konseptual Spring MVC + Thymeleaf:

```java
@GetMapping("/applications/{id}")
public String detail(@PathVariable long id, Model model, Locale locale) {
    ApplicationDetailPage page = applicationPageQuery.getDetailPage(id, locale);
    model.addAttribute("page", page);
    return "applications/detail";
}
```

Template:

```html
<h1 th:text="${page.title}">Application Detail</h1>
<p th:text="${page.statusLabel}">Status</p>
```

### 2.2 MVC template harus memakai page model, bukan entity

Buruk:

```java
model.addAttribute("application", applicationEntity);
```

Kenapa buruk:

- template bisa menyentuh lazy relationship,
- memicu query tersembunyi,
- bocor field internal,
- mempersulit permission filtering,
- sulit testing,
- membuat template bergantung pada domain persistence model.

Baik:

```java
model.addAttribute("page", new ApplicationDetailPage(
    id,
    referenceNo,
    statusLabel,
    applicantName,
    sections,
    allowedActions,
    warnings
));
```

### 2.3 Controller bukan tempat formatting berat

Controller sebaiknya tipis. Formatting dan view-model shaping bisa dilakukan oleh presenter/query service.

```text
Controller
  -> authorize
  -> call query/presenter
  -> attach model
  -> return view
```

```text
ApplicationDetailPresenter
  -> load read model
  -> apply field authorization
  -> localize labels
  -> map allowed actions
  -> build page object
```

Ini menjaga controller tetap sebagai adapter HTTP, bukan presentation engine.

### 2.4 MVC rendering dan DB transaction

Untuk page rendering, hindari template mengakses lazy-loaded entity yang butuh session/transaction masih hidup.

Anti-pattern:

```text
Open Session In View enabled
Template accesses application.offences[0].case.officer.name
N+1 query happens during rendering
```

Masalah:

- query muncul dari template,
- performa sulit diprediksi,
- error terjadi saat view rendering,
- separation of concern hancur.

Pattern yang lebih baik:

```text
Controller -> Query Service -> fully shaped PageViewModel -> Template
```

Template hanya membaca data final.

### 2.5 MVC action rendering dan authorization

UI boleh menyembunyikan tombol berdasarkan permission.

Contoh:

```html
<button th:if="${page.actions.canApprove}">Approve</button>
```

Tetapi backend tetap harus enforce permission saat command diterima.

```text
Hide button != authorize action
```

Rule:

> Template authorization hanya UX optimization, bukan security boundary final.

### 2.6 MVC failure model

Page rendering bisa gagal karena:

- view name salah,
- template syntax error,
- missing model field,
- expression error,
- unsafe/invalid data,
- locale message missing,
- large page timeout,
- lazy loading exception,
- access denied saat building page model.

Untuk production:

- template parse error harus tertangkap di CI/preflight,
- missing message harus punya fallback policy,
- missing model field harus terdeteksi oleh contract test,
- render exception harus menghasilkan error page aman,
- log tidak boleh dump seluruh model kalau ada PII.

---

## 3. Integration Pattern 2: REST Endpoint Returning Rendered Artifact

Kadang REST endpoint tidak hanya mengembalikan JSON, tapi artifact yang di-render:

- HTML preview,
- PDF download,
- generated CSV,
- generated XML,
- generated TXT,
- email preview.

### 3.1 Bentuk umum

```text
GET /cases/{caseId}/documents/{templateCode}/preview
  -> authorize
  -> build render request
  -> render HTML/PDF
  -> return binary/text response
```

Contoh response:

```text
Content-Type: application/pdf
Content-Disposition: inline; filename="notice-case-123.pdf"
```

Atau:

```text
Content-Type: text/html;charset=UTF-8
```

### 3.2 Preview endpoint vs official generation endpoint

Pisahkan endpoint preview dari endpoint generate official artifact.

```text
Preview:
GET /templates/{templateCode}/preview?caseId=123
```

Karakteristik preview:

- tidak membuat dokumen official,
- boleh memakai draft template,
- boleh watermark,
- tidak masuk correspondence history sebagai final,
- tidak mengirim email,
- output bisa berubah.

```text
Official generation:
POST /cases/{caseId}/documents
```

Karakteristik official generation:

- memilih template published/effective,
- membuat immutable record,
- menyimpan template version,
- menyimpan model snapshot/hash,
- menyimpan artifact hash,
- masuk audit trail,
- idempotent terhadap command key.

### 3.3 Idempotency untuk artifact generation

Jika user klik generate dua kali atau network retry terjadi, sistem tidak boleh menghasilkan dua surat official yang berbeda tanpa alasan.

Gunakan idempotency key:

```http
POST /cases/123/documents
Idempotency-Key: case-123-warning-notice-2026-06-19
```

Di server:

```text
if idempotency key already processed:
    return existing document id
else:
    generate, store, record key
```

Untuk regulatory document, idempotency bisa berbasis:

- case id,
- document type,
- transition id,
- template version,
- command id,
- event id.

### 3.4 Rendered REST artifact bukan sekadar file download

Metadata penting:

```text
artifact_id
case_id
template_code
template_version
rendered_at
rendered_by
locale
timezone
data_snapshot_id
sha256_hash
content_type
filename
status
```

Tanpa metadata, artifact sulit diaudit.

### 3.5 Failure model REST artifact

Kemungkinan failure:

- unauthorized,
- template not found,
- template draft not allowed,
- model validation failed,
- render failed,
- PDF conversion failed,
- storage failed,
- audit write failed,
- response streaming failed.

Classification:

```text
4xx:
  invalid request
  unauthorized
  forbidden template
  case not eligible

5xx/retryable:
  storage unavailable
  renderer timeout
  transient PDF service failure

5xx/non-retryable until fix:
  invalid published template
  incompatible model contract
```

---

## 4. Integration Pattern 3: Batch Rendering

Batch rendering adalah saat sistem menghasilkan banyak output sekaligus:

- monthly reminder emails,
- SLA reminder letters,
- annual renewal notices,
- bulk statements,
- scheduled reports,
- mass correspondence.

### 4.1 Batch rendering pipeline

```text
Scheduler / Batch Job
  -> select eligible records
  -> chunk records
  -> build model per record
  -> render artifact
  -> store/send artifact
  -> mark result
  -> emit metrics
```

### 4.2 Jangan load semua record sekaligus

Buruk:

```java
List<Case> cases = repository.findAllEligible();
for (Case c : cases) {
    render(c);
}
```

Risiko:

- memory besar,
- transaction terlalu panjang,
- timeout,
- N+1,
- partial failure sulit.

Lebih baik:

```text
read page/chunk 500
process chunk
commit result
continue next chunk
```

### 4.3 Batch harus punya checkpoint

Setiap item perlu status:

```text
PENDING
PROCESSING
RENDERED
SENT
FAILED_RETRYABLE
FAILED_PERMANENT
SKIPPED
```

Jika job mati di tengah, bisa resume.

### 4.4 Rendering batch harus bounded

Batasi:

- max concurrent renders,
- max model size,
- max output size,
- max render duration,
- max retries,
- max attachment size,
- max email recipients per batch.

Tanpa bound, satu template buruk bisa menjatuhkan worker.

### 4.5 Batch concurrency model

Untuk Java 8–17, biasanya memakai thread pool bounded.

```text
ExecutorService fixed pool
BlockingQueue bounded
Backpressure explicit
```

Untuk Java 21+, virtual threads bisa membantu workload blocking I/O, tetapi rendering CPU-heavy tetap dibatasi oleh CPU.

Rule:

```text
If rendering is CPU-bound -> bound by CPU cores.
If rendering waits on DB/storage/email -> virtual threads can help, but downstream must still be rate-limited.
```

### 4.6 Batch rendering dan template version

Satu batch harus jelas memakai template versi apa.

Pilihan:

#### Fixed-at-batch-start

```text
Batch starts at 10:00.
Template active version is v3.
All 10000 outputs use v3 even if v4 published at 10:05.
```

Cocok untuk consistency.

#### Resolve-per-item

```text
Each item resolves effective template at item processing time.
```

Cocok jika batch sangat panjang dan business ingin latest effective template.

Untuk regulatory correspondence, biasanya lebih aman:

```text
Resolve once per batch run and record template version.
```

### 4.7 Batch partial failure

Dalam batch 10.000 item:

- 9.950 sukses,
- 30 retryable failure,
- 20 permanent failure karena model invalid.

Jangan rollback semua kecuali business memang mensyaratkan all-or-nothing.

Gunakan per-item result:

```text
item_id
status
attempt_count
last_error_code
last_error_message_redacted
render_duration_ms
artifact_id
```

### 4.8 Poison template dan kill switch

Jika template published rusak, batch bisa gagal massal.

Butuh:

- preflight validation sebelum publish,
- canary rendering,
- max failure threshold,
- automatic pause,
- rollback template,
- alert.

Contoh policy:

```text
If failure rate > 5% in first 200 items:
    pause batch
    mark batch NEEDS_REVIEW
    alert template owner
```

---

## 5. Integration Pattern 4: Messaging-Driven Rendering

Messaging-driven rendering cocok untuk asynchronous output.

### 5.1 Bentuk dasar

```text
Domain Service
  -> persist business change
  -> publish event / outbox record
  -> Renderer Consumer
  -> render artifact
  -> send/store
```

Contoh event:

```json
{
  "eventId": "evt-20260619-0001",
  "eventType": "CaseApproved",
  "caseId": "CASE-123",
  "occurredAt": "2026-06-19T10:15:30+07:00",
  "triggeredBy": "officer-001"
}
```

Renderer consumer tidak perlu menerima semua data detail. Ia bisa menerima event minimal, lalu query read model saat memproses. Tetapi ini punya trade-off.

### 5.2 Event-carried state vs event notification

#### Event notification

Event hanya berisi id.

```json
{
  "eventType": "CaseApproved",
  "caseId": "CASE-123"
}
```

Consumer query data terbaru.

Kelebihan:

- event kecil,
- schema lebih stabil,
- tidak membocorkan PII lewat broker.

Kekurangan:

- output bisa memakai data yang berubah setelah event,
- butuh DB/API read,
- sulit reproduce kondisi saat event terjadi.

#### Event-carried state

Event membawa snapshot data.

```json
{
  "eventType": "CaseApproved",
  "caseId": "CASE-123",
  "applicantName": "...",
  "approvedAt": "...",
  "officerName": "..."
}
```

Kelebihan:

- reproducible,
- consumer tidak banyak query,
- output sesuai event-time.

Kekurangan:

- event besar,
- schema rentan berubah,
- PII di broker,
- redaction lebih sulit.

Untuk regulatory output, pattern yang sering paling kuat:

```text
Event carries identity + snapshot reference.
Snapshot stored securely in document/case system.
Renderer loads snapshot by reference.
```

### 5.3 Outbox pattern

Masalah klasik:

```text
DB commit sukses, message publish gagal.
```

Atau:

```text
Message publish sukses, DB rollback.
```

Outbox pattern memecahkan dengan menyimpan event di DB yang sama dengan business transaction:

```text
BEGIN TRANSACTION
  update case status
  insert outbox_event
COMMIT

Separate publisher reads outbox_event and publishes to broker.
```

Dengan begitu, business state dan event record atomik di DB.

### 5.4 After-commit event listener

Untuk beberapa kasus, aplikasi memakai event listener yang berjalan setelah commit.

Pattern:

```text
inside transaction:
    update case
    publish application event

@TransactionalEventListener(AFTER_COMMIT):
    send/render/queue command
```

Ini lebih baik daripada mengirim email sebelum commit, tetapi tidak sekuat outbox jika proses mati tepat setelah commit sebelum listener selesai.

Rule:

```text
If output matters for audit/compliance -> prefer durable outbox.
If output is non-critical UX notification -> after-commit listener may be enough.
```

### 5.5 Message idempotency

Consumer harus siap menerima duplicate message.

Gunakan event id atau rendering command id:

```text
render_key = eventId + templateCode + recipientId
```

Sebelum render:

```text
if render_key already completed:
    ack message
else:
    render and store result
```

### 5.6 Retry strategy

Bedakan retryable vs permanent.

Retryable:

- storage temporary unavailable,
- email gateway timeout,
- network error,
- rate limit,
- transient PDF service failure.

Permanent:

- template not found,
- template/model incompatible,
- invalid recipient email format,
- missing required legal field,
- unauthorized template for tenant.

Policy:

```text
Retryable -> exponential backoff -> dead-letter after max attempt.
Permanent -> no retry, mark failed, alert owner.
```

### 5.7 Poison message

Satu event buruk jangan menghalangi queue.

Need:

- dead-letter queue,
- error classification,
- redacted error payload,
- replay tooling,
- manual correction flow.

---

## 6. Integration Pattern 5: BPMN and Workflow Orchestration

Dalam BPMN/Camunda-style process, rendering sering terjadi pada:

- service task,
- external task worker,
- send task,
- user task creation notification,
- timer event reminder,
- escalation path,
- boundary event,
- process completion artifact.

### 6.1 Rendering sebagai service task

```text
[Review Application]
      |
      v
[Approve?]
      |
      v
[Generate Approval Notice]
      |
      v
[Send Notice]
```

Service task `Generate Approval Notice` memanggil rendering service.

### 6.2 Jangan letakkan template logic di BPMN

Buruk:

```text
BPMN expression chooses salutation, paragraphs, legal wording, and formatting.
```

Baik:

```text
BPMN decides process path.
Rendering service selects template variant and renders output.
```

BPMN cocok untuk:

- state/flow orchestration,
- task sequencing,
- timers,
- escalations,
- human task routing.

Template engine cocok untuk:

- output wording,
- layout,
- conditional presentation,
- artifact composition.

Domain service cocok untuk:

- decision logic,
- eligibility,
- calculation,
- authorization,
- state transitions.

### 6.3 External task worker pattern

Untuk rendering berat, external task worker sering lebih aman daripada menjalankan rendering langsung dalam engine transaction.

```text
BPMN engine creates external task: topic = render-notice
Worker fetches and locks task
Worker calls rendering service
Worker stores artifact id in process variable
Worker completes task
```

Keuntungan:

- workload terisolasi,
- retry bisa dikontrol,
- worker bisa diskalakan,
- engine tidak dibebani PDF/email rendering,
- failure bisa dimodelkan.

### 6.4 Process variables: simpan referensi, bukan artifact besar

Buruk:

```text
processVariable.pdfBytes = huge byte[]
processVariable.htmlBody = huge string
```

Baik:

```text
processVariable.documentId = "DOC-123"
processVariable.templateVersion = "approval-notice@3.2.0"
processVariable.renderStatus = "RENDERED"
```

Process engine bukan object storage.

### 6.5 Timer-based reminders

BPMN timer dapat memicu reminder.

```text
User Task: Submit Additional Documents
Boundary Timer: after 7 days
  -> Generate Reminder Email
  -> Send Reminder
```

Rendering model harus memuat:

- task name,
- due date,
- recipient,
- case reference,
- missing documents,
- action URL,
- locale/timezone,
- reminder sequence number.

### 6.6 Boundary event and escalation letter

Escalation bukan hanya notification; sering mengandung legal meaning.

```text
If user does not respond within 14 days:
  -> generate non-response notice
  -> transition case state
  -> notify officer
```

Penting:

- state transition harus domain/workflow-controlled,
- document generation harus idempotent,
- template version harus recorded,
- deadline calculation harus sudah finalized sebelum render.

### 6.7 BPMN compensation and rendering

Jika proses rollback/compensate, artifact yang sudah dikirim tidak bisa “di-rollback” seperti DB row.

Karena itu:

```text
Generate artifact before send can be reversible.
Send email/letter is irreversible side effect.
```

Pisahkan:

```text
Render Draft Artifact -> Review/Approve -> Send Official Artifact
```

Jika sudah terkirim dan salah:

- issue correction notice,
- void previous document,
- audit reason,
- link superseding document.

Jangan “delete silently”.

---

## 7. Integration Pattern 6: Case Management Lifecycle Rendering

Dalam case management, template dipicu oleh perubahan state, event, atau deadline.

### 7.1 Case state as template trigger

Contoh lifecycle:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
INFO_REQUESTED
APPROVED
REJECTED
APPEALED
CLOSED
```

Setiap transition bisa punya artifact:

```text
SUBMITTED -> acknowledgment email
INFO_REQUESTED -> request-for-information letter
APPROVED -> approval notice
REJECTED -> rejection notice with appeal rights
APPEALED -> appeal acknowledgment
CLOSED -> closure notice
```

### 7.2 Jangan pilih template hanya dari state string

Buruk:

```java
String template = "case-" + case.status().toLowerCase();
```

Lebih baik:

```text
Template selection policy:
  case type
  transition type
  recipient type
  channel
  locale
  tenant/agency
  effective date
  legal basis
```

Contoh:

```text
caseType=LICENCE_RENEWAL
transition=REJECTED
recipient=APPLICANT
channel=EMAIL
locale=en-SG
tenant=CEA
effectiveAt=2026-06-19
=> templateCode=licence-renewal-rejection-applicant-email
=> version=4.1.0
```

### 7.3 Rendering trigger should be event-based

Daripada controller langsung mengirim email setelah update status:

```text
POST /cases/123/approve
  -> approve case
  -> send email inline
```

Lebih baik:

```text
POST /cases/123/approve
  -> approve case
  -> emit CaseApproved event / outbox

Renderer worker:
  -> handle CaseApproved
  -> generate approval notice
  -> send/store
```

Keuntungan:

- command latency rendah,
- retry lebih aman,
- side effect terisolasi,
- audit lebih rapi.

### 7.4 Butuh rendering policy per transition

Contoh policy:

```yaml
transition: APPROVE
outputs:
  - code: APPROVAL_NOTICE_EMAIL
    recipient: APPLICANT
    channel: EMAIL
    timing: AFTER_COMMIT
    required: true
    retry: true
  - code: APPROVAL_CERTIFICATE_PDF
    recipient: APPLICANT
    channel: PORTAL_DOWNLOAD
    timing: SYNC_AFTER_APPROVAL
    required: true
    retry: false
```

Policy ini membuat output tidak tersebar di controller/service/task worker.

### 7.5 Artifact immutability

Untuk regulatory/case document:

```text
Once official document is generated, do not mutate it.
```

Jika ada koreksi:

```text
previous document status = SUPERSEDED
new document generated with new id
link previous_document_id
reason recorded
```

### 7.6 Snapshot discipline

Saat render official output, simpan snapshot atau minimal reference yang reproducible:

```text
caseSnapshotId
partySnapshotId
templateVersion
messageBundleVersion
renderedAt
renderedBy/systemActor
locale
timezone
inputHash
outputHash
```

Ini penting untuk menjawab:

```text
Why did the applicant receive this wording on that date?
Which data did the system use?
Which template version was active?
Who triggered it?
Was it re-rendered later or immutable?
```

---

## 8. Integration Pattern 7: State-Based Correspondence

Correspondence adalah komunikasi formal dalam lifecycle case.

### 8.1 Correspondence is not just email

Correspondence bisa berupa:

- portal inbox message,
- email,
- PDF letter,
- printed mail,
- SMS notification,
- internal note,
- external agency message,
- generated XML/JSON to another system.

Template engine menghasilkan content, tetapi correspondence subsystem mengatur:

- recipient,
- channel,
- delivery status,
- retries,
- bounce,
- audit,
- read receipt,
- legal status.

### 8.2 Correspondence record model

```text
Correspondence
  id
  caseId
  documentId
  templateCode
  templateVersion
  channel
  recipientType
  recipientAddressMasked
  subject
  status
  createdAt
  renderedAt
  sentAt
  deliveredAt
  failedAt
  failureCode
  triggeredBy
  triggerEventId
  correlationId
```

### 8.3 Separate render status and delivery status

Jangan gabungkan:

```text
FAILED
```

Karena failure bisa terjadi di tahap berbeda.

Lebih baik:

```text
renderStatus: PENDING | RENDERED | RENDER_FAILED
sendStatus: NOT_APPLICABLE | PENDING | SENT | FAILED | BOUNCED
storageStatus: STORED | STORAGE_FAILED
```

### 8.4 Delivery can fail after successful rendering

Contoh:

```text
PDF rendered successfully.
Email gateway timeout.
```

Dokumen tetap ada. Email bisa retry.

Atau:

```text
Email sent successfully.
Audit storage failed.
```

Ini lebih buruk karena side effect eksternal sudah terjadi tapi audit internal gagal. Maka audit/storage biasanya harus dilakukan sebelum send official email.

Pattern:

```text
render -> store artifact -> create correspondence record -> send -> update delivery status
```

---

## 9. Transaction Boundary: Render Inside or Outside Transaction?

Ini salah satu decision paling penting.

### 9.1 Render inside DB transaction

```text
BEGIN
  update case
  render document
  insert document record
COMMIT
```

Kelebihan:

- data konsisten dalam satu transaction,
- jika render gagal, status case bisa rollback.

Kekurangan:

- transaction lama,
- rendering bisa CPU/I/O heavy,
- lock ditahan lebih lama,
- PDF/email/storage tidak cocok dalam transaction,
- external side effect tidak bisa rollback.

Cocok untuk:

- small synchronous text generation,
- render yang tidak melakukan I/O eksternal,
- output tidak besar,
- business mensyaratkan all-or-nothing.

### 9.2 Render after commit

```text
BEGIN
  update case
  insert outbox event
COMMIT

After commit:
  render/send
```

Kelebihan:

- transaction singkat,
- side effect setelah state committed,
- retry lebih mudah.

Kekurangan:

- output eventually consistent,
- render bisa gagal setelah case status berubah,
- perlu compensation/alert.

Cocok untuk:

- email notification,
- asynchronous document generation,
- workflow side effect.

### 9.3 Hybrid: snapshot inside transaction, render outside

Pattern kuat untuk compliance:

```text
BEGIN
  update case
  create immutable render snapshot
  insert outbox render command referencing snapshot
COMMIT

Worker:
  load snapshot
  render artifact
  store result
```

Kelebihan:

- transaction singkat,
- rendering async,
- output reproducible sesuai committed snapshot,
- retry aman.

Ini biasanya pattern terbaik untuk regulatory correspondence.

---

## 10. Re-render vs Immutable Snapshot

### 10.1 Re-render adalah bahaya jika output punya legal meaning

Jika dokumen bisa di-render ulang dari data terbaru, output bisa berubah.

Contoh:

```text
Applicant address changed today.
Re-render rejection notice from last month now shows new address.
```

Ini bisa salah secara audit.

### 10.2 Official artifact harus immutable

Untuk output official:

```text
render once
store bytes
store hash
store metadata
never mutate
```

Kalau butuh lihat lagi, ambil stored artifact, bukan render ulang.

### 10.3 Preview boleh re-render

Preview berbeda:

```text
Preview uses current draft template and current data.
Official uses published template and captured snapshot.
```

Watermark preview:

```text
PREVIEW ONLY - NOT AN OFFICIAL DOCUMENT
```

### 10.4 Re-render use cases yang valid

Re-render bisa valid untuk:

- preview,
- non-official dynamic dashboard,
- regenerate lost artifact jika snapshot + template version + dependencies masih identik,
- migration validation,
- test replay.

Tetapi official re-render harus menghasilkan hash sama atau tercatat sebagai new version/superseding artifact.

---

## 11. Template Selection Architecture

Template selection sering dianggap sederhana, padahal enterprise system membutuhkan policy.

### 11.1 Input selection

```text
TemplateSelectionRequest
  purpose
  outputType
  channel
  tenantId
  caseType
  transition
  recipientType
  locale
  effectiveAt
  jurisdiction
  userSegment
  experimentFlag?   // rarely for regulated output
```

### 11.2 Output selection

```text
TemplateSelectionResult
  templateCode
  templateVersion
  engine
  outputFormat
  fallbackApplied
  selectionRulesTrace
```

### 11.3 Selection trace

Untuk audit:

```text
Selected rejection-email-v4 because:
  caseType=LICENCE_RENEWAL matched rule R12
  recipientType=APPLICANT matched rule R12
  locale=en-SG available
  tenant=CEA override found
  effectiveAt=2026-06-19 matched version 4.1.0
```

Ini membantu debugging saat user bertanya “kenapa wording-nya seperti ini?”.

### 11.4 Fallback hierarchy

Contoh fallback:

```text
tenant + locale-specific
  -> tenant default locale
  -> global locale-specific
  -> global default locale
```

Tetapi untuk legal/regulatory document, fallback tidak selalu boleh.

Rule:

```text
Marketing email may fallback.
Legal notice should fail if required locale/template version missing.
```

---

## 12. Data Aggregation Across Bounded Contexts

Rendering sering membutuhkan data dari banyak context:

- case data,
- applicant profile,
- licensing data,
- payment data,
- officer data,
- document list,
- appeal information,
- compliance history,
- configuration/reference data.

### 12.1 Jangan biarkan template memanggil service

Buruk:

```html
${paymentService.getOutstandingAmount(case.id)}
```

Ini bahaya:

- template punya side effect/read dependency tersembunyi,
- sulit test,
- security boundary bocor,
- performance tidak terkendali,
- retry tidak deterministik.

Baik:

```java
CaseNoticeModel model = assembler.assemble(caseId, renderContext);
renderer.render(template, model);
```

### 12.2 Aggregator/presenter layer

```text
RenderingDataAssembler
  -> CaseReadService
  -> PartyReadService
  -> PaymentReadService
  -> DocumentReadService
  -> ReferenceDataService
  -> AuthorizationService
  -> LocalizationService
  -> produce ViewModel
```

### 12.3 Read consistency

Jika data dari banyak system, tentukan consistency requirement.

Options:

#### Latest-read model

```text
Read latest from each context.
```

Cocok untuk preview/dynamic page.

#### Event-time snapshot

```text
Read data as-of event time or snapshot id.
```

Cocok untuk official notices.

#### Command-created snapshot

```text
When transition happens, capture all required render data.
```

Paling defensible untuk legal output.

---

## 13. Integration with REST APIs and External Systems

Rendering kadang memerlukan data eksternal.

### 13.1 Hindari external API call saat template processing

Buruk:

```text
Template expression calls external service.
```

Masalah:

- unpredictable latency,
- failure di tengah render,
- retry sulit,
- template tidak deterministic.

### 13.2 Prefetch before render

Pattern:

```text
1. Validate request
2. Fetch all external data with timeout/retry policy
3. Build explicit model
4. Render with no external I/O
```

### 13.3 Store external data snapshot

Jika output official memakai data external:

```text
externalDataSource
externalRequestId
externalResponseHash
externalDataCapturedAt
externalDataSnapshot
```

Ini mencegah dispute saat external data berubah.

---

## 14. Error Taxonomy Across Integration Patterns

Sistem rendering production harus punya error taxonomy yang konsisten.

### 14.1 Error classes

```text
TEMPLATE_NOT_FOUND
TEMPLATE_VERSION_NOT_ACTIVE
TEMPLATE_PARSE_ERROR
TEMPLATE_SECURITY_VIOLATION
MODEL_VALIDATION_ERROR
MISSING_REQUIRED_FIELD
LOCALIZATION_MISSING
RENDER_TIMEOUT
OUTPUT_TOO_LARGE
PDF_CONVERSION_FAILED
STORAGE_FAILED
DELIVERY_FAILED
UNAUTHORIZED_TEMPLATE_ACCESS
TENANT_TEMPLATE_MISMATCH
```

### 14.2 Mapping error to action

| Error | Retry? | Owner | Typical Action |
|---|---:|---|---|
| TEMPLATE_NOT_FOUND | No | Template owner/dev | publish/correct config |
| TEMPLATE_PARSE_ERROR | No | Template owner/dev | fix template, rollback |
| MODEL_VALIDATION_ERROR | No | App/team owner | fix assembler/data contract |
| RENDER_TIMEOUT | Maybe | Platform/team | inspect template/model size |
| STORAGE_FAILED | Yes | Infra/platform | retry/backoff |
| DELIVERY_FAILED | Yes/No | Messaging/email ops | retry or mark bounce |
| LOCALIZATION_MISSING | Depends | Content owner | add message/fallback |
| TEMPLATE_SECURITY_VIOLATION | No | Security/platform | investigate template attempt |

### 14.3 Redacted error payload

Do not log full model.

Log:

```json
{
  "correlationId": "...",
  "templateCode": "approval-notice",
  "templateVersion": "3.2.0",
  "engine": "freemarker",
  "caseId": "CASE-123",
  "errorCode": "MISSING_REQUIRED_FIELD",
  "field": "appealDeadline",
  "templateLine": 42,
  "templateColumn": 17
}
```

Not:

```json
{
  "fullApplicantProfile": "...",
  "nric": "...",
  "address": "..."
}
```

---

## 15. Observability Across MVC, Batch, Messaging, BPMN

### 15.1 Metrics

Core metrics:

```text
render_requests_total{engine,templateCode,version,channel}
render_failures_total{engine,templateCode,errorCode}
render_duration_ms{engine,templateCode,outputType}
render_output_size_bytes{templateCode,outputType}
template_selection_fallback_total{templateCode,tenant,locale}
model_validation_failures_total{templateCode,field}
```

For batch:

```text
batch_items_total{batchType,status}
batch_render_duration_ms
batch_failure_rate
batch_retry_count
```

For messaging:

```text
render_consumer_lag
render_message_attempts
render_dead_letter_total
render_duplicate_skipped_total
```

For BPMN:

```text
process_render_task_duration
process_render_task_failure_total
render_task_retries
```

### 15.2 Tracing

Trace path:

```text
HTTP command / BPMN task / message event
  -> data assembler
  -> template selector
  -> renderer
  -> storage/email/document service
```

Useful span tags:

```text
template.code
template.version
render.engine
render.output_type
render.channel
case.id
correlation.id
snapshot.id
```

Avoid high-cardinality labels in metrics, but trace tags can be richer.

### 15.3 Audit vs observability

Observability answers:

```text
Is system healthy?
Why is latency high?
Which template fails?
```

Audit answers:

```text
What exactly was generated?
When?
For whom?
Using which data/template?
Who triggered it?
Was it sent?
```

Do not confuse them. Metrics are not audit records.

---

## 16. Security Across Integration Patterns

### 16.1 MVC security

Risks:

- XSS,
- field leakage,
- hidden field sensitive data,
- UI-only authorization,
- template exposing session/security object too broadly.

Controls:

- escaped output by default,
- field-level view model,
- backend authorization,
- CSRF for unsafe methods,
- no raw entity exposure,
- no broad service exposure.

### 16.2 REST artifact security

Risks:

- IDOR download,
- previewing draft template without permission,
- artifact cache leak,
- wrong content type,
- filename injection,
- PII in URL/query.

Controls:

- authorize artifact access by case/document permission,
- signed/short-lived download links if needed,
- safe `Content-Disposition`,
- no PII in filename/URL,
- cache-control for sensitive artifacts,
- audit download for official documents.

### 16.3 Messaging security

Risks:

- PII in event payload,
- unauthorized consumer,
- replay attack,
- duplicate rendering,
- topic exposed too broadly.

Controls:

- minimal event payload,
- encryption where needed,
- access-controlled topics,
- idempotency,
- event schema governance,
- redacted dead-letter payload.

### 16.4 BPMN security

Risks:

- process variable leakage,
- broad worker permissions,
- user task notification to wrong assignee,
- rendering before authorization state finalized.

Controls:

- process variables store references, not sensitive blobs,
- worker scoped credentials,
- recipient resolver with authorization,
- after-commit/outbox style rendering,
- audit process instance id + artifact id.

---

## 17. Pattern: Render Command

Unify all integrations through a command object.

```java
public record RenderCommand(
    String commandId,
    String triggerType,
    String triggerId,
    String templateCode,
    String tenantId,
    String locale,
    String timezone,
    String outputType,
    String channel,
    String subjectRefType,
    String subjectRefId,
    String snapshotId,
    Map<String, Object> parameters
) {}
```

The controller, batch job, BPMN worker, and message consumer all produce a `RenderCommand`.

Then rendering service does:

```text
validate command
resolve template
load snapshot/current data
build model
validate model
render
store/send/return
record result
```

This prevents duplicated rendering logic across adapters.

---

## 18. Pattern: Render Result

```java
public record RenderResult(
    String renderId,
    String commandId,
    String templateCode,
    String templateVersion,
    String engine,
    String outputType,
    String artifactId,
    String outputHash,
    long outputSizeBytes,
    Instant renderedAt,
    RenderStatus status,
    String errorCode
) {}
```

Render result must be usable by:

- REST response,
- batch item status,
- BPMN process variable,
- message ack logic,
- correspondence record,
- audit trail.

---

## 19. Pattern: Rendering Policy Matrix

Instead of hardcoding everywhere, define policy.

```yaml
policies:
  - trigger: CASE_APPROVED
    caseType: LICENCE_APPLICATION
    outputs:
      - templateCode: approval-email
        channel: EMAIL
        recipient: APPLICANT
        mode: ASYNC
        required: true
        snapshot: REQUIRED
      - templateCode: approval-certificate-pdf
        channel: PORTAL
        recipient: APPLICANT
        mode: ASYNC
        required: true
        snapshot: REQUIRED
```

Benefits:

- easier review,
- consistent behavior,
- testable output expectation,
- separation from controller/service code.

Caution:

- policy engine must not become uncontrolled dynamic code,
- changes need governance,
- legal output policy needs approval.

---

## 20. Pattern: Snapshot + Outbox + Renderer Worker

This is one of the strongest patterns for enterprise/regulatory systems.

```text
Command Handler
  BEGIN TX
    validate transition
    update case state
    create render snapshot
    insert render_outbox command
  COMMIT

Outbox Publisher / Worker
  read pending render command
  load snapshot
  resolve template version
  validate model
  render artifact
  store artifact
  create correspondence/document record
  mark command completed
```

### 20.1 Why this pattern is strong

- business state and render command are atomically recorded,
- rendering happens after commit,
- output is based on immutable snapshot,
- retries are safe,
- audit is strong,
- user request latency is controlled,
- renderer can scale independently.

### 20.2 Trade-off

- more moving parts,
- eventual consistency,
- requires monitoring,
- requires replay/admin tooling.

For top-tier systems, that trade-off is usually worth it.

---

## 21. Example Architecture: Case Approval Notice

### 21.1 Flow

```text
Officer clicks Approve
  -> ApproveCaseCommand
  -> Case domain validates transition
  -> Case state APPROVED
  -> Snapshot captured
  -> RenderApprovalNotice command inserted in outbox
  -> HTTP returns success

Renderer worker
  -> picks command
  -> resolves approval-notice-email@v3.2.0
  -> builds model from snapshot
  -> renders HTML + text email
  -> stores correspondence record
  -> sends email
  -> marks command completed
```

### 21.2 Invariants

```text
A case can only have one official approval notice per approval transition.
The approval notice must use the template effective at approval time.
The rendered notice must be based on snapshot captured at approval time.
The email may retry, but the official document content must not change across retries.
The artifact id must be linked to transition id and case id.
```

### 21.3 Failure handling

If render fails:

```text
case remains APPROVED
render command FAILED_PERMANENT or RETRYABLE
officer/admin dashboard shows pending correspondence issue
manual retry after fix
```

If email send fails:

```text
artifact remains stored
sendStatus FAILED_RETRYABLE
retry send using same artifact
```

If template later fixed:

```text
Do not silently mutate already generated artifact.
Either retry failed render using same template version if corrected version was not official, or publish new version and require explicit re-render command with reason.
```

---

## 22. Example Architecture: User Task Reminder in BPMN

### 22.1 Flow

```text
BPMN User Task: Submit Documents
Boundary Timer: PT7D
  -> External Task: generate-reminder
  -> External Task Worker creates RenderCommand
  -> Rendering Service renders reminder email
  -> Email Service sends
  -> Worker completes BPMN task
```

### 22.2 Model

```java
public record ReminderEmailModel(
    String recipientName,
    String caseReferenceNo,
    String taskName,
    String dueDateLabel,
    List<String> missingDocuments,
    String portalUrl,
    String supportContact
) {}
```

### 22.3 Important invariant

```text
Reminder content must reflect the task state at reminder trigger time, not after the user submits documents 5 minutes later.
```

Use snapshot or task state version.

---

## 23. Example Architecture: Batch Renewal Notice

### 23.1 Flow

```text
Daily scheduler
  -> select licenses expiring in 60 days
  -> create batch run
  -> create item commands
  -> workers render/send notices
  -> dashboard shows progress
```

### 23.2 Batch item state

```text
PENDING
LOCKED
RENDERED
SENT
FAILED_RETRYABLE
FAILED_PERMANENT
SKIPPED_ALREADY_SENT
```

### 23.3 Idempotency key

```text
renewal-notice:{licenseId}:{expiryDate}:{noticeType}
```

This prevents duplicate renewal notices for same cycle.

---

## 24. Java 8–25 Considerations

### 24.1 Java 8 baseline

If supporting Java 8:

- avoid records/sealed classes in shared library,
- use immutable classes manually,
- use `CompletableFuture` carefully,
- use bounded `ExecutorService`,
- use `java.time` where possible,
- avoid newer APIs in common module.

### 24.2 Java 11/17

Benefits:

- stronger runtime baseline,
- better GC options,
- HTTP client from Java 11 if external calls are needed before render,
- improved container awareness.

### 24.3 Java 21+

Potential benefits:

- virtual threads for blocking orchestration around rendering,
- better structured concurrency patterns if available in chosen Java version/features,
- modern GC choices,
- records/sealed interfaces for internal model/result types if baseline allows.

But:

```text
Virtual threads do not make CPU-bound rendering infinitely scalable.
```

Still apply:

- rate limit,
- bounded concurrency,
- output size limit,
- downstream backpressure.

### 24.4 Java 25 perspective

For Java 25-era systems, use modern Java for internal rendering platform where possible, but keep template behavior stable. Template authors should not care whether runtime is Java 8 or Java 25 except through available data model and engine configuration.

---

## 25. Anti-Patterns

### 25.1 Controller sends email directly after DB update

```text
approve case
send email
commit transaction
```

Risk:

- email sent but transaction rollback,
- impossible to reconcile.

### 25.2 Template queries database/service

Risk:

- hidden I/O,
- unpredictable performance,
- security leak.

### 25.3 Process variable stores full rendered artifact

Risk:

- bloated process engine,
- sensitive data leakage,
- slow queries.

### 25.4 Re-render official document from latest data

Risk:

- audit inconsistency,
- legal dispute.

### 25.5 One catch-all template for all states

```text
case-notification.ftl contains 500 if/else branches.
```

Risk:

- unreadable,
- untestable,
- high blast radius.

Better:

```text
One template per stable communication purpose.
Shared macros/fragments for common layout.
```

### 25.6 Delivery retry re-renders content

If send failed, retry should usually resend same rendered artifact, not re-render from current data.

### 25.7 No template selection trace

When output is wrong, nobody knows why template v4 was selected instead of v3.

### 25.8 Missing failure dashboard

Async rendering without dashboard becomes invisible failure.

---

## 26. Practical Design Checklist

Before integrating rendering into workflow, answer:

```text
1. What triggers rendering?
2. Is rendering synchronous or asynchronous?
3. Is output preview or official artifact?
4. Is output mutable or immutable?
5. Which template version is used?
6. When is template version resolved?
7. What data snapshot is used?
8. Can output be re-rendered?
9. What is idempotency key?
10. What happens if rendering fails?
11. What happens if delivery fails?
12. What is retryable?
13. What is permanent failure?
14. Who owns the template?
15. Who owns the data model?
16. How is recipient resolved?
17. How is authorization enforced?
18. What is stored for audit?
19. What metrics are emitted?
20. How can ops replay or fix failed items?
```

---

## 27. Reference Implementation Sketch

### 27.1 Port interface

```java
public interface RenderingApplicationService {
    RenderResult render(RenderCommand command);
}
```

### 27.2 Adapter sources

```text
MvcController
RestArtifactController
BatchJob
MessageConsumer
BpmnExternalTaskWorker
CaseTransitionHandler
```

All adapters produce `RenderCommand`.

### 27.3 Core pipeline

```java
public RenderResult render(RenderCommand command) {
    RenderContext context = contextFactory.create(command);

    TemplateDescriptor template = templateSelector.select(context);
    Object model = modelAssembler.assemble(context, template);

    modelValidator.validate(template, model);

    RenderedOutput output = engineRegistry
        .get(template.engine())
        .render(template, model, context);

    Artifact artifact = artifactStore.store(output, context, template);

    auditRecorder.record(command, template, artifact, context);

    return RenderResult.success(command, template, artifact);
}
```

In production, add:

- error taxonomy,
- transaction handling,
- idempotency,
- metrics,
- tracing,
- redacted logging,
- retry handling.

---

## 28. Deep Mental Model: Four Boundaries

A top 1% engineer sees four boundaries.

### 28.1 Domain boundary

```text
What happened? What is true?
```

Example:

```text
Case approved.
Deadline expired.
Appeal submitted.
```

### 28.2 Rendering boundary

```text
How should truth be represented as artifact?
```

Example:

```text
Approval notice email.
PDF certificate.
Reminder letter.
```

### 28.3 Delivery boundary

```text
How does artifact reach recipient/system?
```

Example:

```text
Email gateway.
Portal inbox.
Download endpoint.
External API.
```

### 28.4 Audit boundary

```text
Can we prove what happened later?
```

Example:

```text
Template v3.2.0.
Snapshot S-123.
Output hash H.
Sent at T.
Recipient R.
Triggered by event E.
```

If these boundaries are mixed, systems become hard to reason about.

---

## 29. Final Summary

Part ini membahas bahwa template rendering dalam sistem Java enterprise harus diintegrasikan sebagai controlled artifact generation subsystem, bukan utility string replacement.

Hal penting:

1. MVC rendering harus memakai page/view model, bukan entity.
2. REST artifact endpoint harus membedakan preview dan official generation.
3. Batch rendering butuh checkpoint, bounded concurrency, failure threshold, dan per-item status.
4. Messaging-driven rendering butuh outbox, idempotency, retry taxonomy, dan DLQ.
5. BPMN integration sebaiknya memakai service/external task untuk rendering berat.
6. Case management rendering harus dipicu oleh event/transition dengan template selection policy.
7. Official artifact harus immutable dan berbasis snapshot.
8. Transaction boundary harus dipilih dengan sadar: inside transaction, after commit, atau snapshot + outbox.
9. Observability bukan audit; keduanya dibutuhkan.
10. Template engine harus berada di belakang rendering service yang punya command/result model konsisten.

Mental model paling penting:

```text
Domain decides truth.
Rendering represents truth.
Delivery moves artifact.
Audit proves history.
```

Jika empat boundary itu jelas, FreeMarker/Thymeleaf bisa menjadi bagian dari arsitektur enterprise yang aman, scalable, testable, dan defensible.

---

## 30. Status Series

```text
Part 27 selesai.
Seri belum selesai.
Berikutnya: Part 28 — Migration Engineering: JSP to Thymeleaf/FreeMarker, Legacy Templates, and Modernization.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-026.md">⬅️ Part 26 — Building a Production Template Rendering Service</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-028.md">Part 28 — Migration Engineering: JSP to Thymeleaf/FreeMarker, Legacy Templates, and Modernization ➡️</a>
</div>
